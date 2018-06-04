import { Injectable, EventEmitter } from '@angular/core';
import { Router } from '@angular/router';
import * as auth0 from 'auth0-js';
import { PersonService } from './person.service';
import { PersonListModel } from '../models/person-list-model';

@Injectable()
export class AuthService {
    auth0 = new auth0.WebAuth({
        clientID: 'mpXWwpAOBTt5aUM1SE2q5KuUtr4YvUE9',
        domain: 'trifolia.auth0.com',
        responseType: 'token id_token',
        audience: 'https://trifolia.lantanagroup.com/api',
        redirectUri: 'http://localhost:49366/login',
        scope: 'openid profile name nickname email'
    });
    public userProfile: any;
    public person: PersonListModel;
    public authExpiresAt: number;
    public authChanged: EventEmitter<any>;
    public instanceNum = Math.random();

    constructor(
        public router: Router,
        private personService: PersonService) {
        this.authExpiresAt = JSON.parse(localStorage.getItem('expires_at'));
        this.authChanged = new EventEmitter();
    }

    public login(): void {
        this.auth0.authorize();
    }

    public handleAuthentication(): void {
        this.auth0.parseHash((err, authResult) => {
            if (authResult && authResult.accessToken && authResult.idToken) {
                window.location.hash = '';
                this.setSession(authResult);
                this.getProfile(() => {
                    this.router.navigate(['/home']);
                    this.authChanged.emit();
                });
            } else if (err) {
                this.router.navigate(['/home']);
                console.log(err);
            }
        });
    }

    public logout(): void {
        // Remove tokens and expiry time from localStorage
        localStorage.removeItem('token');
        localStorage.removeItem('id_token');
        localStorage.removeItem('expires_at');
        this.userProfile = null;
        this.person = null;
        this.authExpiresAt = null;
        // Go back to the home route
        this.router.navigate(['/']);
        this.authChanged.emit();
    }

    public isAuthenticated(): boolean {
        return new Date().getTime() < this.authExpiresAt;
    }

    public getProfile(cb): void {
        const accessToken = localStorage.getItem('token');

        if (!accessToken) {
            throw new Error('Access token must exist to fetch profile');
        }

        const self = this;
        this.auth0.client.userInfo(accessToken, (userInfoErr, userProfile) => {
            if (userInfoErr) {
                return cb(userInfoErr);
            }

            if (userProfile) {
                self.userProfile = userProfile;

                this.personService.getMe()
                    .subscribe(person => {
                        self.person = person;

                        cb(null, userProfile, person);
                        self.authChanged.emit();
                    }, personErr => {
                        console.log(personErr);
                        cb(personErr);
                    });
            }
        });
    }

    private setSession(authResult): void {
        // Set the time that the access token will expire at
        const expiresAt = JSON.stringify((authResult.expiresIn * 1000) + new Date().getTime());
        localStorage.setItem('token', authResult.accessToken);
        localStorage.setItem('id_token', authResult.idToken);
        localStorage.setItem('expires_at', expiresAt);
        this.authExpiresAt = JSON.parse(expiresAt);
    }
}
