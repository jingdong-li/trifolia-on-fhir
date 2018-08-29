import { Injectable } from '@angular/core';
import {Bundle, CodeSystem} from '../models/stu3/fhir';
import {Observable} from 'rxjs/Observable';
import {HttpClient} from '@angular/common/http';

@Injectable()
export class CodeSystemService {

  constructor(
      private http: HttpClient) {

  }

    public save(codeSystem: CodeSystem): Observable<CodeSystem> {
        if (codeSystem.id) {
            const url = '/api/codeSystem/' + encodeURIComponent(codeSystem.id);
            return this.http.put<CodeSystem>(url, codeSystem);
        } else {
            return this.http.post<CodeSystem>('/api/codeSystem', codeSystem);
        }
    }

    public search() {
        return this.http.get<Bundle>('/api/codeSystem?_summary=true');
    }

    public get(id: string) {
        const url = '/api/codeSystem/' + encodeURIComponent(id);
        return this.http.get<CodeSystem>(url);
    }

    public delete(id: string) {
        const url = '/api/codeSystem/' + encodeURIComponent(id);
        return this.http.delete(url);
    }
}