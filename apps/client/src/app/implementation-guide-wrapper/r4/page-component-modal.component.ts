import {Component, Input, OnInit} from '@angular/core';
import {NgbActiveModal} from '@ng-bootstrap/ng-bootstrap';
import {
  Binary,
  Extension,
  ImplementationGuide,
  ImplementationGuidePageComponent
} from '../../../../../../libs/tof-lib/src/lib/r4/fhir';
import {Globals} from '../../../../../../libs/tof-lib/src/lib/globals';
import {getImplementationGuideMediaReferences, MediaReference} from '../../../../../../libs/tof-lib/src/lib/fhirHelper';
import {Observable} from 'rxjs';
import {debounceTime, distinct, distinctUntilChanged, map} from 'rxjs/operators';

@Component({
  templateUrl: './page-component-modal.component.html',
  styleUrls: ['./page-component-modal.component.css']
})
export class PageComponentModalComponent implements OnInit {
  private inputPage: ImplementationGuidePageComponent;
  public page: ImplementationGuidePageComponent;
  public implementationGuide: ImplementationGuide;
  public rootPage: boolean;
  public pageNavMenus: string[];

  constructor(public activeModal: NgbActiveModal) {

  }

  public getMediaReferences(): MediaReference[] {
    return getImplementationGuideMediaReferences('r4', this.implementationGuide);
  }

  public setPage(value: ImplementationGuidePageComponent) {
    this.inputPage = value;
    this.page = new ImplementationGuidePageComponent(this.inputPage);
  }

  public get nameType(): 'Url'|'Reference' {
    if (this.page.hasOwnProperty('nameReference')) {
      return 'Reference';
    } else if (this.page.hasOwnProperty('nameUrl')) {
      return 'Url';
    }
  }

  public set nameType(value: 'Url'|'Reference') {
    if (this.nameType === value) {
      return;
    }

    if (this.nameType === 'Reference' && value === 'Url') {
      delete this.page.nameReference;
      this.page.nameUrl = '';
    } else if (this.nameType === 'Url' && value === 'Reference') {
      delete this.page.nameUrl;
      this.page.nameReference = { reference: '', display: '' };
    }
  }

  public get hasPageNavMenu(): boolean {
    const extension = (this.page.extension || []).find(e => e.url === Globals.extensionUrls['extension-ig-page-nav-menu']);
    return !!extension;
  }

  public set hasPageNavMenu(value: boolean) {
    let extension = (this.page.extension || []).find(e => e.url === Globals.extensionUrls['extension-ig-page-nav-menu']);

    if (value && !extension) {
      this.page.extension = this.page.extension || [];
      this.page.extension.push(new Extension({ url: Globals.extensionUrls['extension-ig-page-nav-menu'], valueString: '' }));
    } else if (!value && extension) {
      const index = this.page.extension.indexOf(extension);
      this.page.extension.splice(index, 1);
    }
  }

  public get pageNavMenu(): string {
    const extension = (this.page.extension || []).find(e => e.url === Globals.extensionUrls['extension-ig-page-nav-menu']);

    if (extension) {
      return extension.valueString;
    }
  }

  public set pageNavMenu(value: string) {
    let extension = (this.page.extension || []).find(e => e.url === Globals.extensionUrls['extension-ig-page-nav-menu']);

    if (!extension) {
      this.page.extension = this.page.extension || [];
      extension = new Extension({ url: Globals.extensionUrls['extension-ig-page-nav-menu'] });
      this.page.extension.push(extension);
    }

    extension.valueString = value;
  }

  pageNavMenuSearch = (text$: Observable<string>) =>
    text$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      map(term => term.length < 2 ? [] : this.pageNavMenus.filter(v => v.toLowerCase().indexOf(term.toLowerCase()) > -1).slice(0, 10)),
      distinct()
    )

  public importFile(file: File) {
    const reader = new FileReader();

    reader.onload = (e: any) => {
      const result = e.target.result;
      this.page.contentMarkdown = result.substring(5 + file.type.length + 8);
    };

    reader.readAsDataURL(file);
  }

  ok() {
    if (this.inputPage) {
      // Update the properties of the input page with the changes from the cloned version
      Object.assign(this.inputPage, this.page);
    }

    this.activeModal.close();
  }

  ngOnInit() {
    const allPages: ImplementationGuidePageComponent[] = [];
    const getPages = (parent: ImplementationGuidePageComponent) => {
      allPages.push(parent);
      (parent.page || []).forEach(p => getPages(p));
    };

    if (this.implementationGuide.definition && this.implementationGuide.definition.page) {
      getPages(this.implementationGuide.definition.page);
    }

    this.pageNavMenus = allPages
      .filter(p => {
        const extension = (p.extension || []).find(e => e.url === Globals.extensionUrls['extension-ig-page-nav-menu']);
        return !!extension;
      })
      .map(p => {
        const extension = (p.extension || []).find(e => e.url === Globals.extensionUrls['extension-ig-page-nav-menu']);

        if (extension) {
          return extension.valueString;
        }
      });
  }
}
