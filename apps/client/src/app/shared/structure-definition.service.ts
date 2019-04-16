import {Injectable} from '@angular/core';
import {Observable} from 'rxjs';
import {HttpClient} from '@angular/common/http';
import {Bundle, StructureDefinition} from '../../../../../libs/tof-lib/src/lib/stu3/fhir';
import {FhirService} from './fhir.service';
import {FileService} from './file.service';

export class StructureDefinitionImplementationnGuide {
  public id: string;
  public name: string;
  public isRemoved = false;
  public isNew = false;
}

export class StructureDefinitionOptions {
  public implementationGuides: StructureDefinitionImplementationnGuide[] = [];
}

export class GetStructureDefinitionModel {
  public resource: StructureDefinition;
  public options?: StructureDefinitionOptions;

  constructor(resource?: StructureDefinition, options?: StructureDefinitionOptions) {
    this.resource = resource;
    this.options = options;
  }
}

@Injectable()
export class StructureDefinitionService {

  constructor(
    private http: HttpClient,
    private fhirService: FhirService,
    private fileService: FileService) {
  }

  public getStructureDefinitions(page?: number, nameText?: string, urlText?: string, implementationGuideId?: string, titleText?: string): Observable<Bundle> {
    let url = '/api/structureDefinition?';

    if (page) {
      url += `page=${page.toString()}&`;
    }

    if (nameText) {
      url += `name=${encodeURIComponent(nameText)}&`;
    }

    if (urlText) {
      url += `urlText=${encodeURIComponent(urlText)}&`;
    }

    if (implementationGuideId) {
      url += `implementationGuideId=${encodeURIComponent(implementationGuideId)}&`;
    }

    if (titleText) {
      url += `title=${encodeURIComponent(titleText)}&`;
    }

    return this.http.get<Bundle>(url);
  }

  public getStructureDefinition(id: string): Observable<GetStructureDefinitionModel> {
    if (id === 'from-file') {
      if (this.fileService.file) {
        return new Observable<GetStructureDefinitionModel>((observer) => {
          observer.next({
            resource: <StructureDefinition>this.fileService.file.resource
          });
        });
      }
    }

    const url = '/api/structureDefinition/' + encodeURIComponent(id);
    return this.http.get<GetStructureDefinitionModel>(url);
  }

  public getBaseStructureDefinition(resourceType: string): Observable<StructureDefinition> {
    return new Observable(subscriber => {
      const foundResource = this.fhirService.profiles.find((profile) => {
        return profile.id === resourceType;
      });

      if (foundResource) {
        subscriber.next(foundResource);
      } else {
        subscriber.error('Could not find base structure definition for ' + resourceType);
      }
    });
    // return this.http.get('/api/structureDefinition/base/' + resourceType);
  }

  public save(structureDefinition: StructureDefinition, options?: StructureDefinitionOptions): Observable<StructureDefinition> {
    let url = '/api/structureDefinition';
    const body = {
      resource: structureDefinition,
      options: options
    };

    if (structureDefinition.id) {
      url += '/' + encodeURIComponent(structureDefinition.id);
      return this.http.put<StructureDefinition>(url, body);
    } else {
      return this.http.post<StructureDefinition>(url, body);
    }
  }

  public delete(id: string) {
    return this.http.delete('/api/structureDefinition/' + encodeURIComponent(id));
  }
}