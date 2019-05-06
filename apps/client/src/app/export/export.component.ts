import {Component, OnInit, ViewChild} from '@angular/core';
import {ImplementationGuideService} from '../shared/implementation-guide.service';
import {saveAs} from 'file-saver';
import {ExportOptions, ExportService} from '../shared/export.service';
import {ExportFormats} from '../models/export-formats.enum';
import {HtmlExportStatus, SocketService} from '../shared/socket.service';
import {Globals} from '../../../../../libs/tof-lib/src/lib/globals';
import {CookieService} from 'angular2-cookie/core';
import {ConfigService} from '../shared/config.service';
import {Bundle, DomainResource, ImplementationGuide} from '../../../../../libs/tof-lib/src/lib/stu3/fhir';
import {FileModel, GithubService} from '../shared/github.service';
import {FhirService} from '../shared/fhir.service';
import {Observable} from 'rxjs';
import {ExportGithubPanelComponent} from '../export-github-panel/export-github-panel.component';
import {debounceTime, distinctUntilChanged, map, switchMap, tap} from 'rxjs/operators';
import {AuthService} from '../shared/auth.service';
import {NgbTabChangeEvent} from '@ng-bootstrap/ng-bootstrap';

@Component({
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.css']
})
export class ExportComponent implements OnInit {
  public message: string;
  public socketOutput = '';
  private packageId;
  public githubResourcesBundle: Bundle;
  public githubCommitMessage: string;
  public searching = false;
  public activeTabId = 'html';

  @ViewChild('githubPanel') githubPanel: ExportGithubPanelComponent;

  public options = new ExportOptions();
  public selectedImplementationGuide: ImplementationGuide;

  constructor(
    private authService: AuthService,
    private implementationGuideService: ImplementationGuideService,
    private socketService: SocketService,
    private exportService: ExportService,
    private cookieService: CookieService,
    private githubService: GithubService,
    private fhirService: FhirService,
    private configService: ConfigService) {

    this.options.implementationGuideId = this.cookieService.get(Globals.cookieKeys.exportLastImplementationGuideId + '_' + this.configService.fhirServer);
    this.options.responseFormat = <any>this.cookieService.get(Globals.cookieKeys.lastResponseFormat) || 'application/json';
    this.options.executeIgPublisher = false;            // Never execute the ig publisher. This is only for exporting.
    this.options.downloadOutput = true;

    // Handle intermittent disconnects mid-export by notifying the server that we are currently exporting the given packageId
    this.socketService.onConnected.subscribe(() => {
      if (this.packageId) {
        this.socketService.notifyExporting(this.packageId);
      }
    });
  }

  private getImplementationGuideResources() {
    this.message = 'Retrieving resources for the implementation guide';

    this.exportService.export({implementationGuideId: this.options.implementationGuideId, exportFormat: ExportFormats.Bundle})
      .subscribe((response) => {
        const reader = new FileReader();

        reader.addEventListener('loadend', (e) => {
          const bundleJson = (<any>e.srcElement).result;

          try {
            this.githubResourcesBundle = <Bundle>JSON.parse(bundleJson);
            this.message = '';
          } catch (ex) {
            this.message = 'Could not parse the bundle: ' + ex.message;
          }
        });

        reader.readAsText(response.body);
      }, (err) => {
        this.message = this.fhirService.getErrorString(err);
      });
  }

  public onTabChange(event: NgbTabChangeEvent) {
    this.activeTabId = event.nextId;

    switch (this.activeTabId) {
      case 'html':
        this.options.exportFormat = ExportFormats.HTML;
        break;
      case 'bundle':
        this.options.exportFormat = ExportFormats.Bundle;
        break;
      case 'github':
        this.options.exportFormat = ExportFormats.GitHub;
        this.getImplementationGuideResources();
        break;
      default:
        throw new Error('Unexpected tab selected. Cannot set export format.');
    }
  }

  public implementationGuideChanged(implementationGuide: ImplementationGuide) {
    this.selectedImplementationGuide = implementationGuide;
    this.options.implementationGuideId = implementationGuide ? implementationGuide.id : undefined;
    this.githubResourcesBundle = null;
    this.githubCommitMessage = null;

    const cookieKey = Globals.cookieKeys.exportLastImplementationGuideId + '_' + this.configService.fhirServer;

    if (implementationGuide && implementationGuide.id) {
      this.cookieService.put(cookieKey, implementationGuide.id);

      if (this.options.exportFormat === ExportFormats.GitHub) {
        this.getImplementationGuideResources();
      }
    } else if (this.cookieService.get(cookieKey)) {
      this.cookieService.remove(cookieKey);
    }
  }

  public searchImplementationGuide = (text$: Observable<string>) => {
    return text$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      tap(() => this.searching = true),
      switchMap((term) => {
        return this.implementationGuideService.getImplementationGuides(1, term).pipe(
          map((bundle) => {
            return (bundle.entry || []).map((entry) => <ImplementationGuide> entry.resource);
          })
        );
      }),
      tap(() => this.searching = false)
    );
  }

  public searchFormatter = (ig: ImplementationGuide) => {
    return `${ig.name} (id: ${ig.id})`;
  }

  public clearImplementationGuide() {
    const cookieKey = Globals.cookieKeys.exportLastImplementationGuideId + '_' + this.configService.fhirServer;

    this.selectedImplementationGuide =
      this.options.implementationGuideId = null;

    if (this.cookieService.get(cookieKey)) {
      this.cookieService.remove(cookieKey);
    }
  }

  public responseFormatChanged() {
    this.cookieService.put(Globals.cookieKeys.lastResponseFormat, this.options.responseFormat);
  }

  public get exportDisabled(): boolean {
    if (!this.options.implementationGuideId || !this.options.exportFormat) {
      return true;
    }

    if (this.options.exportFormat === ExportFormats.GitHub) {
      if (!this.githubService.token || !this.githubResourcesBundle || !this.githubResourcesBundle.entry) {
        return true;
      }

      const filtered = (this.githubResourcesBundle.entry || []).filter((entry) => {
        return this.fhirService.getResourceGithubDetails(entry.resource).hasAllDetails();
      });

      if (filtered.length === 0 || !this.githubCommitMessage) {
        return true;
      }

      return false;
    }

    return !this.options.responseFormat;
  }

  private exportGithub() {
    const implementationGuide = (this.githubResourcesBundle.entry || []).find((entry) => entry.resource.resourceType === 'ImplementationGuide').resource;
    const implementationGuideDetails = this.fhirService.getResourceGithubDetails(implementationGuide);

    const queue = <DomainResource[]> (this.githubResourcesBundle.entry || [])
      .filter((entry) => {
        const details = this.fhirService.getResourceGithubDetails(entry.resource);
        return !!(details.owner && details.repository && details.branch && details.path);
      })
      .filter((entry) => {
        return !!this.githubPanel.checkedIds.find((id) => id === entry.resource.id);
      })
      .map((entry) => entry.resource);

    const files = queue.map((resource) => {
      const details = this.fhirService.getResourceGithubDetails(resource);
      const content = details.path.endsWith('.xml') ? this.fhirService.serialize(resource) : JSON.stringify(resource, null, '\t');

      return <FileModel>{
        path: details.path,
        content: content
      };
    });

    this.githubService.updateContents(implementationGuideDetails.owner, implementationGuideDetails.repository, this.githubCommitMessage, files, implementationGuideDetails.branch)
      .subscribe(() => {
        this.message = 'Done exporting to GitHub';
      }, (err) => {
        this.message = this.fhirService.getErrorString(err);
      });
  }

  public export() {
    this.socketOutput = '';
    this.message = 'Exporting...';

    this.cookieService.put(Globals.cookieKeys.exportLastImplementationGuideId + '_' + this.configService.fhirServer, this.options.implementationGuideId);

    if (this.options.exportFormat === ExportFormats.GitHub) {
      try {
        this.exportGithub();
      } catch (ex) {
        this.message = ex.message;
      }
    } else {
      this.exportService.export(this.options)
        .subscribe((results: any) => {
          if (this.options.exportFormat === ExportFormats.Bundle) {
            const igName = this.selectedImplementationGuide.name.replace(/\s/g, '_');
            const extension = (this.options.responseFormat === 'application/xml' ? '.xml' : '.json');

            this.message = 'Done exporting';

            saveAs(results.body, igName + extension);
          } else if (this.options.exportFormat === ExportFormats.HTML) {
            const reader = new FileReader();
            reader.addEventListener('loadend', (e: any) => {
              const result = JSON.parse(e.srcElement.result);
              this.packageId = result.content;
            });
            reader.readAsText(results.body);
          }
        }, (err) => {
          this.message = this.fhirService.getErrorString(err);
        });
    }
  }

  ngOnInit() {
    if (this.options.implementationGuideId) {
      this.implementationGuideService.getImplementationGuide(this.options.implementationGuideId)
        .subscribe((implementationGuide: ImplementationGuide) => {
          this.selectedImplementationGuide = implementationGuide;
        }, (err) => this.message = this.fhirService.getErrorString(err));
    }

    this.socketService.onHtmlExport.subscribe((data: HtmlExportStatus) => {
      if (data.packageId === this.packageId) {
        this.socketOutput += data.message;

        if (!data.message.endsWith('\n')) {
          this.socketOutput += '\r\n';
        }

        if (data.status === 'complete') {
          this.message = 'Done exporting';

          let shouldDownload = this.options.downloadOutput;

          if (this.options.exportFormat === ExportFormats.HTML && !this.options.executeIgPublisher) {
            shouldDownload = true;
          }

          if (shouldDownload) {
            const igName = this.selectedImplementationGuide.name.replace(/\s/g, '_');

            this.exportService.getPackage(this.packageId)
              .subscribe((results: any) => {
                saveAs(results.body, igName + '.zip');
              });
          }
        }
      }
    }, (err) => {
      this.socketOutput += 'An error occurred while communicating with the server for the export';
    });
  }
}
