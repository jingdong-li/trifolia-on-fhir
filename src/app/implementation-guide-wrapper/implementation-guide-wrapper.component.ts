import {Component, ComponentFactoryResolver, OnInit, ViewContainerRef} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {FileService} from '../services/file.service';
import {ConfigService} from '../services/config.service';
import {ImplementationGuideComponent as STU3ImplementationGuideComponent} from './stu3/implementation-guide.component';
import {ImplementationGuideComponent as R4ImplementationGuideComponent} from './r4/implementation-guide.component';

/**
 * This class is responsible for determining which implementation-guide component to render
 * based on the fhirVersion that is supported by the fhir server.
 */
@Component({
    selector: 'app-implementation-guide-wrapper',
    template: '<div></div>'
})
export class ImplementationGuideWrapperComponent implements OnInit {

    constructor(
        private viewContainerRef: ViewContainerRef,
        private componentFactoryResolver: ComponentFactoryResolver,
        private route: ActivatedRoute,
        private fileService: FileService,
        private configService: ConfigService) {
        this.versionChanged();
    }

    versionChanged() {
        let componentFactory;
        let version = this.configService.fhirVersion;
        const id = this.route.snapshot.paramMap.get('id');

        if (id === 'from-file' && this.fileService.file) {
            version = this.fileService.file.fhirVersion;
        }

        if (version.major >= 3 && version.minor >= 4) {
            componentFactory = this.componentFactoryResolver.resolveComponentFactory(R4ImplementationGuideComponent);
        } else {
            componentFactory = this.componentFactoryResolver.resolveComponentFactory(STU3ImplementationGuideComponent);
        }

        this.viewContainerRef.clear();
        this.viewContainerRef.createComponent(componentFactory);
    }

    ngOnInit() {
        this.configService.fhirServerChanged.subscribe(() => {
            this.versionChanged();
        });
    }
}