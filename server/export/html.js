"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const log4js = require("log4js");
const path = require("path");
const _ = require("underscore");
const rp = require("request-promise");
const fs = require("fs-extra");
const config = require("config");
const tmp = require("tmp");
const vkbeautify = require("vkbeautify");
const bundle_1 = require("./bundle");
const globals_1 = require("../../src/app/globals");
const fhirConfig = config.get('fhir');
const serverConfig = config.get('server');
class HtmlExporter {
    constructor(fhirServerBase, fhirServerId, fhirVersion, fhir, io, socketId, implementationGuideId) {
        this.log = log4js.getLogger();
        this.fhirServerBase = fhirServerBase;
        this.fhirServerId = fhirServerId;
        this.fhirVersion = fhirVersion;
        this.fhir = fhir;
        this.io = io;
        this.socketId = socketId;
        this.implementationGuideId = implementationGuideId;
    }
    getDisplayName(name) {
        if (!name) {
            return;
        }
        if (typeof name === 'string') {
            return name;
        }
        let display = name.family;
        if (name.given) {
            if (display) {
                display += ', ';
            }
            else {
                display = '';
            }
            display += name.given.join(' ');
        }
        return display;
    }
    createTableFromArray(headers, data) {
        let output = '<table>\n<thead>\n<tr>\n';
        _.each(headers, (header) => {
            output += `<th>${header}</th>\n`;
        });
        output += '</tr>\n</thead>\n<tbody>\n';
        _.each(data, (row) => {
            output += '<tr>\n';
            _.each(row, (cell) => {
                output += `<td>${cell}</td>\n`;
            });
            output += '</tr>\n';
        });
        output += '</tbody>\n</table>\n';
        return output;
    }
    sendSocketMessage(status, message) {
        if (!this.socketId) {
            this.log.error('Won\'t send socket message for export because the original request did not specify a socketId');
            return;
        }
        if (this.io) {
            this.io.to(this.socketId).emit('html-export', {
                packageId: this.packageId,
                status: status,
                message: message
            });
        }
    }
    getIgPublisher(useLatest, executeIgPublisher) {
        if (!executeIgPublisher) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve) => {
            const fileName = 'org.hl7.fhir.igpublisher.jar';
            const defaultPath = path.join(__dirname, '../../ig-publisher');
            const defaultFilePath = path.join(defaultPath, fileName);
            if (useLatest === true) {
                this.log.debug('Request to get latest version of FHIR IG publisher. Retrieving from: ' + fhirConfig.latestPublisher);
                this.sendSocketMessage('progress', 'Downloading latest FHIR IG publisher');
                // TODO: Check http://build.fhir.org/version.info first
                rp(fhirConfig.latestPublisher, { encoding: null })
                    .then((results) => {
                    this.log.debug('Successfully downloaded latest version of FHIR IG Publisher. Ensuring latest directory exists');
                    const latestPath = path.join(defaultPath, 'latest');
                    fs.ensureDirSync(latestPath);
                    // noinspection JSUnresolvedFunction
                    const buff = Buffer.from(results, 'utf8');
                    const latestFilePath = path.join(latestPath, fileName);
                    this.log.debug('Saving FHIR IG publisher to ' + latestFilePath);
                    fs.writeFileSync(latestFilePath, buff);
                    resolve(latestFilePath);
                })
                    .catch((err) => {
                    this.log.error(`Error getting latest version of FHIR IG publisher: ${err}`);
                    this.sendSocketMessage('progress', 'Encountered error downloading latest IG publisher, will use pre-loaded/default IG publisher');
                    resolve(defaultFilePath);
                });
            }
            else {
                this.log.debug('Using built-in version of FHIR IG publisher for export');
                this.sendSocketMessage('progress', 'Using existing/default version of FHIR IG publisher');
                resolve(defaultFilePath);
            }
        });
    }
    copyExtension(destExtensionsDir, extensionFileName, isXml, fhir) {
        const sourceExtensionsDir = path.join(__dirname, '../../src/assets/stu3/extensions');
        const sourceExtensionFileName = path.join(sourceExtensionsDir, extensionFileName);
        let destExtensionFileName = path.join(destExtensionsDir, extensionFileName);
        if (!isXml) {
            fs.copySync(sourceExtensionFileName, destExtensionFileName);
        }
        else {
            const extensionJson = fs.readFileSync(sourceExtensionFileName).toString();
            const extensionXml = fhir.jsonToXml(extensionJson);
            destExtensionFileName = destExtensionFileName.substring(0, destExtensionFileName.indexOf('.json')) + '.xml';
            fs.writeFileSync(destExtensionFileName, extensionXml);
        }
    }
    getDependencies(control, isXml, resourcesDir, fhir, fhirServerConfig) {
        const isStu3 = fhirServerConfig && fhirServerConfig.version === 'stu3';
        // Load the ig dependency extensions into the resources directory
        if (isStu3 && control.dependencyList && control.dependencyList.length > 0) {
            const destExtensionsDir = path.join(resourcesDir, 'structuredefinition');
            fs.ensureDirSync(destExtensionsDir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency.json', isXml, fhir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency-version.json', isXml, fhir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency-location.json', isXml, fhir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency-name.json', isXml, fhir);
        }
        return Promise.resolve([]); // This isn't actually needed, since the IG Publisher attempts to resolve these dependency automatically
        /*
        // Attempt to resolve the dependency's definitions and include it in the package
        const deferred = Q.defer();
        const promises = _.map(control.dependencyList, (dependency) => {
            const dependencyUrl =
                dependency.location +
                (dependency.location.endsWith('/') ? '' : '/') + 'definitions.' +
                (isXml ? 'xml' : 'json') +
                '.zip';
            return getDependency(dependencyUrl, dependency.name);
        });
    
        Q.all(promises)
            .then(deferred.resolve)
            .catch(deferred.reject);
    
        return deferred.promise;
        */
    }
    getFhirControlVersion(fhirServerConfig) {
        const configVersion = fhirServerConfig ? fhirServerConfig.version : null;
        // TODO: Add more logic
        switch (configVersion) {
            case 'stu3':
                return '3.0.1';
            default:
                return '4.0.0';
        }
    }
    updateTemplates(rootPath, bundle, implementationGuide) {
        const mainResourceTypes = ['ImplementationGuide', 'ValueSet', 'CodeSystem', 'StructureDefinition', 'CapabilityStatement'];
        const distinctResources = _.chain(bundle.entry)
            .map((entry) => entry.resource)
            .uniq((resource) => resource.id)
            .value();
        const valueSets = _.filter(distinctResources, (resource) => resource.resourceType === 'ValueSet');
        const codeSystems = _.filter(distinctResources, (resource) => resource.resourceType === 'CodeSystem');
        const profiles = _.filter(distinctResources, (resource) => resource.resourceType === 'StructureDefinition' && (!resource.baseDefinition || !resource.baseDefinition.endsWith('Extension')));
        const extensions = _.filter(distinctResources, (resource) => resource.resourceType === 'StructureDefinition' && resource.baseDefinition && resource.baseDefinition.endsWith('Extension'));
        const capabilityStatements = _.filter(distinctResources, (resource) => resource.resourceType === 'CapabilityStatement');
        const otherResources = _.filter(distinctResources, (resource) => mainResourceTypes.indexOf(resource.resourceType) < 0);
        if (implementationGuide) {
            const indexPath = path.join(rootPath, 'source/pages/index.md');
            if (implementationGuide.description) {
                const descriptionContent = '### Description\n\n' + implementationGuide.description + '\n\n';
                fs.appendFileSync(indexPath, descriptionContent);
            }
            if (implementationGuide.contact) {
                const authorsData = _.map(implementationGuide.contact, (contact) => {
                    const foundEmail = _.find(contact.telecom, (telecom) => telecom.system === 'email');
                    return [contact.name, foundEmail ? `<a href="mailto:${foundEmail.value}">${foundEmail.value}</a>` : ''];
                });
                const authorsContent = '### Authors\n\n' + this.createTableFromArray(['Name', 'Email'], authorsData) + '\n\n';
                fs.appendFileSync(indexPath, authorsContent);
            }
        }
        if (profiles.length > 0) {
            const profilesData = _.chain(profiles)
                .sortBy((profile) => profile.name)
                .map((profile) => {
                return [`<a href="StructureDefinition-${profile.id}.html">${profile.name}</a>`, profile.description || ''];
            }).value();
            const profilesTable = this.createTableFromArray(['Name', 'Description'], profilesData);
            const profilesPath = path.join(rootPath, 'source/pages/profiles.md');
            fs.appendFileSync(profilesPath, '### Profiles\n\n' + profilesTable + '\n\n');
        }
        if (extensions.length > 0) {
            const extData = _.chain(extensions)
                .sortBy((extension) => extension.name)
                .map((extension) => {
                return [`<a href="StructureDefinition-${extension.id}.html">${extension.name}</a>`, extension.description || ''];
            }).value();
            const extContent = this.createTableFromArray(['Name', 'Description'], extData);
            const extPath = path.join(rootPath, 'source/pages/profiles.md');
            fs.appendFileSync(extPath, '### Extensions\n\n' + extContent + '\n\n');
        }
        if (valueSets.length > 0) {
            let vsContent = '### Value Sets\n\n';
            const vsPath = path.join(rootPath, 'source/pages/terminology.md');
            _.chain(valueSets)
                .sortBy((valueSet) => valueSet.title || valueSet.name)
                .each((valueSet) => {
                vsContent += `- [${valueSet.title || valueSet.name}](ValueSet-${valueSet.id}.html)\n`;
            });
            fs.appendFileSync(vsPath, vsContent + '\n\n');
        }
        if (codeSystems.length > 0) {
            let csContent = '### Code Systems\n\n';
            const csPath = path.join(rootPath, 'source/pages/terminology.md');
            _.chain(codeSystems)
                .sortBy((codeSystem) => codeSystem.title || codeSystem.name)
                .each((codeSystem) => {
                csContent += `- [${codeSystem.title || codeSystem.name}](ValueSet-${codeSystem.id}.html)\n`;
            });
            fs.appendFileSync(csPath, csContent + '\n\n');
        }
        if (capabilityStatements.length > 0) {
            const csData = _.chain(capabilityStatements)
                .sortBy((capabilityStatement) => capabilityStatement.name)
                .map((capabilityStatement) => {
                return [`<a href="CapabilityStatement-${capabilityStatement.id}.html">${capabilityStatement.name}</a>`, capabilityStatement.description || ''];
            }).value();
            const csContent = this.createTableFromArray(['Name', 'Description'], csData);
            const csPath = path.join(rootPath, 'source/pages/capstatements.md');
            fs.appendFileSync(csPath, '### CapabilityStatements\n\n' + csContent);
        }
        if (otherResources.length > 0) {
            const oData = _.chain(otherResources)
                .sortBy((resource) => {
                let display = resource.title || this.getDisplayName(resource.name) || resource.id;
                return resource.resourceType + display;
            })
                .map((resource) => {
                let name = resource.title || this.getDisplayName(resource.name) || resource.id;
                return [resource.resourceType, `<a href="${resource.resourceType}-${resource.id}.html">${name}</a>`];
            })
                .value();
            const oContent = this.createTableFromArray(['Type', 'Name'], oData);
            const csPath = path.join(rootPath, 'source/pages/other.md');
            fs.appendFileSync(csPath, '### Other Resources\n\n' + oContent);
        }
    }
    writeFilesForResources(rootPath, resource) {
        if (!resource || !resource.resourceType || resource.resourceType === 'ImplementationGuide') {
            return;
        }
        const introPath = path.join(rootPath, `source/pages/_includes/${resource.id}-intro.md`);
        const searchPath = path.join(rootPath, `source/pages/_includes/${resource.id}-search.md`);
        const summaryPath = path.join(rootPath, `source/pages/_includes/${resource.id}-summary.md`);
        let intro = '---\n' +
            `title: ${resource.resourceType}-${resource.id}-intro\n` +
            'layout: default\n' +
            `active: ${resource.resourceType}-${resource.id}-intro\n` +
            '---\n\n';
        if (resource.description) {
            intro += resource.description;
        }
        fs.writeFileSync(introPath, intro);
        fs.writeFileSync(searchPath, 'TODO - Search');
        fs.writeFileSync(summaryPath, 'TODO - Summary');
    }
    getStu3Control(implementationGuide, bundle, version) {
        const canonicalBaseRegex = /^(.+?)\/ImplementationGuide\/.+$/gm;
        const canonicalBaseMatch = canonicalBaseRegex.exec(implementationGuide.url);
        const packageIdExtension = _.find(implementationGuide.extension, (extension) => extension.url === new globals_1.Globals().extensionUrls['extension-ig-package-id']);
        let canonicalBase;
        if (!canonicalBaseMatch || canonicalBaseMatch.length < 2) {
            canonicalBase = implementationGuide.url.substring(0, implementationGuide.url.lastIndexOf('/'));
        }
        else {
            canonicalBase = canonicalBaseMatch[1];
        }
        // TODO: Extract npm-name from IG extension.
        // currently, IG resource has to be in XML format for the IG Publisher
        const control = {
            tool: 'jekyll',
            source: 'implementationguide/' + implementationGuide.id + '.xml',
            'npm-name': packageIdExtension && packageIdExtension.valueString ? packageIdExtension.valueString : implementationGuide.id + '-npm',
            license: 'CC0-1.0',
            paths: {
                qa: 'generated_output/qa',
                temp: 'generated_output/temp',
                output: 'output',
                txCache: 'generated_output/txCache',
                specification: 'http://hl7.org/fhir/STU3',
                pages: [
                    'framework',
                    'source/pages'
                ],
                resources: ['source/resources']
            },
            pages: ['pages'],
            'extension-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'allowed-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'sct-edition': 'http://snomed.info/sct/731000124108',
            canonicalBase: canonicalBase,
            defaults: {
                'Location': { 'template-base': 'ex.html' },
                'ProcedureRequest': { 'template-base': 'ex.html' },
                'Organization': { 'template-base': 'ex.html' },
                'MedicationStatement': { 'template-base': 'ex.html' },
                'SearchParameter': { 'template-base': 'base.html' },
                'StructureDefinition': {
                    'template-mappings': 'sd-mappings.html',
                    'template-base': 'sd.html',
                    'template-defns': 'sd-definitions.html'
                },
                'Immunization': { 'template-base': 'ex.html' },
                'Patient': { 'template-base': 'ex.html' },
                'StructureMap': {
                    'content': false,
                    'script': false,
                    'template-base': 'ex.html',
                    'profiles': false
                },
                'ConceptMap': { 'template-base': 'base.html' },
                'Practitioner': { 'template-base': 'ex.html' },
                'OperationDefinition': { 'template-base': 'base.html' },
                'CodeSystem': { 'template-base': 'base.html' },
                'Communication': { 'template-base': 'ex.html' },
                'Any': {
                    'template-format': 'format.html',
                    'template-base': 'base.html'
                },
                'PractitionerRole': { 'template-base': 'ex.html' },
                'ValueSet': { 'template-base': 'base.html' },
                'CapabilityStatement': { 'template-base': 'base.html' },
                'Observation': { 'template-base': 'ex.html' }
            },
            resources: {}
        };
        if (version) {
            control.version = version;
        }
        // Set the dependencyList based on the extensions in the IG
        const dependencyExtensions = _.filter(implementationGuide.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency');
        // R4 ImplementationGuide.dependsOn
        control.dependencyList = _.chain(dependencyExtensions)
            .filter((dependencyExtension) => {
            const locationExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-location');
            const nameExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-name');
            return !!locationExtension && !!locationExtension.valueString && !!nameExtension && !!nameExtension.valueString;
        })
            .map((dependencyExtension) => {
            const locationExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-location');
            const nameExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-name');
            const versionExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-version');
            return {
                location: locationExtension ? locationExtension.valueUri : '',
                name: nameExtension ? nameExtension.valueString : '',
                version: versionExtension ? versionExtension.valueString : ''
            };
        })
            .value();
        // Define the resources in the control and what templates they should use
        if (bundle && bundle.entry) {
            for (let i = 0; i < bundle.entry.length; i++) {
                const entry = bundle.entry[i];
                const resource = entry.resource;
                if (resource.resourceType === 'ImplementationGuide') {
                    continue;
                }
                control.resources[resource.resourceType + '/' + resource.id] = {
                    base: resource.resourceType + '-' + resource.id + '.html',
                    defns: resource.resourceType + '-' + resource.id + '-definitions.html'
                };
            }
        }
        return control;
    }
    getR4Control(implementationGuide, bundle, version) {
        const canonicalBaseRegex = /^(.+?)\/ImplementationGuide\/.+$/gm;
        const canonicalBaseMatch = canonicalBaseRegex.exec(implementationGuide.url);
        let canonicalBase;
        if (!canonicalBaseMatch || canonicalBaseMatch.length < 2) {
            canonicalBase = implementationGuide.url.substring(0, implementationGuide.url.lastIndexOf('/'));
        }
        else {
            canonicalBase = canonicalBaseMatch[1];
        }
        // currently, IG resource has to be in XML format for the IG Publisher
        const control = {
            tool: 'jekyll',
            source: 'implementationguide/' + implementationGuide.id + '.xml',
            'npm-name': implementationGuide.packageId || implementationGuide.id + '-npm',
            license: implementationGuide.license || 'CC0-1.0',
            paths: {
                qa: 'generated_output/qa',
                temp: 'generated_output/temp',
                output: 'output',
                txCache: 'generated_output/txCache',
                specification: 'http://hl7.org/fhir/R4/',
                pages: [
                    'framework',
                    'source/pages'
                ],
                resources: ['source/resources']
            },
            pages: ['pages'],
            'extension-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'allowed-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'sct-edition': 'http://snomed.info/sct/731000124108',
            canonicalBase: canonicalBase,
            defaults: {
                'Location': { 'template-base': 'ex.html' },
                'ProcedureRequest': { 'template-base': 'ex.html' },
                'Organization': { 'template-base': 'ex.html' },
                'MedicationStatement': { 'template-base': 'ex.html' },
                'SearchParameter': { 'template-base': 'base.html' },
                'StructureDefinition': {
                    'template-mappings': 'sd-mappings.html',
                    'template-base': 'sd.html',
                    'template-defns': 'sd-definitions.html'
                },
                'Immunization': { 'template-base': 'ex.html' },
                'Patient': { 'template-base': 'ex.html' },
                'StructureMap': {
                    'content': false,
                    'script': false,
                    'template-base': 'ex.html',
                    'profiles': false
                },
                'ConceptMap': { 'template-base': 'base.html' },
                'Practitioner': { 'template-base': 'ex.html' },
                'OperationDefinition': { 'template-base': 'base.html' },
                'CodeSystem': { 'template-base': 'base.html' },
                'Communication': { 'template-base': 'ex.html' },
                'Any': {
                    'template-format': 'format.html',
                    'template-base': 'base.html'
                },
                'PractitionerRole': { 'template-base': 'ex.html' },
                'ValueSet': { 'template-base': 'base.html' },
                'CapabilityStatement': { 'template-base': 'base.html' },
                'Observation': { 'template-base': 'ex.html' }
            },
            resources: {}
        };
        if (version) {
            control.version = version;
        }
        if (implementationGuide.fhirVersion && implementationGuide.fhirVersion.length > 0) {
            control['fixed-business-version'] = implementationGuide.fhirVersion[0];
        }
        control.dependencyList = _.chain(implementationGuide.dependsOn)
            .filter((dependsOn) => {
            const locationExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-location');
            const nameExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-name');
            return !!locationExtension && !!locationExtension.valueString && !!nameExtension && !!nameExtension.valueString;
        })
            .map((dependsOn) => {
            const locationExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-location');
            const nameExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-name');
            return {
                location: locationExtension ? locationExtension.valueString : '',
                name: nameExtension ? nameExtension.valueString : '',
                version: dependsOn.version
            };
        })
            .value();
        // Define the resources in the control and what templates they should use
        if (bundle && bundle.entry) {
            for (let i = 0; i < bundle.entry.length; i++) {
                const entry = bundle.entry[i];
                const resource = entry.resource;
                if (resource.resourceType === 'ImplementationGuide') {
                    continue;
                }
                control.resources[resource.resourceType + '/' + resource.id] = {
                    base: resource.resourceType + '-' + resource.id + '.html',
                    defns: resource.resourceType + '-' + resource.id + '-definitions.html'
                };
            }
        }
        return control;
    }
    getStu3PageContent(implementationGuide, page) {
        const contentExtension = _.find(page.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-page-content');
        if (contentExtension && contentExtension.valueReference && contentExtension.valueReference.reference && page.source) {
            const reference = contentExtension.valueReference.reference;
            if (reference.startsWith('#')) {
                const contained = _.find(implementationGuide.contained, (contained) => contained.id === reference.substring(1));
                const binary = contained && contained.resourceType === 'Binary' ? contained : undefined;
                if (binary) {
                    return {
                        fileName: page.source,
                        content: Buffer.from(binary.content, 'base64').toString()
                    };
                }
            }
        }
    }
    writeStu3Page(pagesPath, implementationGuide, page, level, tocEntries) {
        const pageContent = this.getStu3PageContent(implementationGuide, page);
        if (page.kind !== 'toc' && pageContent && pageContent.content) {
            const newPagePath = path.join(pagesPath, pageContent.fileName);
            const content = '---\n' +
                `title: ${page.title}\n` +
                'layout: default\n' +
                `active: ${page.title}\n` +
                '---\n\n' + pageContent.content;
            fs.writeFileSync(newPagePath, content);
        }
        // Add an entry to the TOC
        tocEntries.push({ level: level, fileName: page.kind === 'page' && pageContent ? pageContent.fileName : null, title: page.title });
        _.each(page.page, (subPage) => this.writeStu3Page(pagesPath, implementationGuide, subPage, level + 1, tocEntries));
    }
    getPageExtension(page) {
        switch (page.generation) {
            case 'html':
            case 'generated':
                return '.html';
            case 'xml':
                return '.xml';
            default:
                return '.md';
        }
    }
    writeR4Page(pagesPath, implementationGuide, page, level, tocEntries) {
        let fileName;
        if (page.nameReference && page.nameReference.reference && page.title) {
            const reference = page.nameReference.reference;
            if (reference.startsWith('#')) {
                const contained = _.find(implementationGuide.contained, (contained) => contained.id === reference.substring(1));
                const binary = contained && contained.resourceType === 'Binary' ? contained : undefined;
                if (binary && binary.data) {
                    fileName = page.title.replace(/ /g, '_');
                    if (fileName.indexOf('.') < 0) {
                        fileName += this.getPageExtension(page);
                    }
                    const newPagePath = path.join(pagesPath, fileName);
                    // noinspection JSUnresolvedFunction
                    const binaryContent = Buffer.from(binary.data, 'base64').toString();
                    const content = '---\n' +
                        `title: ${page.title}\n` +
                        'layout: default\n' +
                        `active: ${page.title}\n` +
                        `---\n\n${binaryContent}`;
                    fs.writeFileSync(newPagePath, content);
                }
            }
        }
        // Add an entry to the TOC
        tocEntries.push({ level: level, fileName: fileName, title: page.title });
        _.each(page.page, (subPage) => this.writeR4Page(pagesPath, implementationGuide, subPage, level + 1, tocEntries));
    }
    generateTableOfContents(rootPath, tocEntries, shouldAutoGenerate, pageContent) {
        const tocPath = path.join(rootPath, 'source/pages/toc.md');
        let tocContent = '';
        if (shouldAutoGenerate) {
            _.each(tocEntries, (entry) => {
                let fileName = entry.fileName;
                if (fileName && fileName.endsWith('.md')) {
                    fileName = fileName.substring(0, fileName.length - 3) + '.html';
                }
                for (let i = 1; i < entry.level; i++) {
                    tocContent += '    ';
                }
                tocContent += '* ';
                if (fileName) {
                    tocContent += `<a href="${fileName}">${entry.title}</a>\n`;
                }
                else {
                    tocContent += `${entry.title}\n`;
                }
            });
        }
        else if (pageContent && pageContent.content) {
            tocContent = pageContent.content;
        }
        if (tocContent) {
            fs.appendFileSync(tocPath, tocContent);
        }
    }
    writeStu3Pages(rootPath, implementationGuide) {
        const tocFilePath = path.join(rootPath, 'source/pages/toc.md');
        const tocEntries = [];
        if (implementationGuide.page) {
            const autoGenerateExtension = _.find(implementationGuide.page.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-page-auto-generate-toc');
            const shouldAutoGenerate = autoGenerateExtension && autoGenerateExtension.valueBoolean === true;
            const pageContent = this.getStu3PageContent(implementationGuide, implementationGuide.page);
            const pagesPath = path.join(rootPath, 'source/pages');
            fs.ensureDirSync(pagesPath);
            this.writeStu3Page(pagesPath, implementationGuide, implementationGuide.page, 1, tocEntries);
            this.generateTableOfContents(rootPath, tocEntries, shouldAutoGenerate, pageContent);
        }
    }
    writeR4Pages(rootPath, implementationGuide) {
        const tocEntries = [];
        let shouldAutoGenerate = true;
        let rootPageContent;
        let rootPageFileName;
        if (implementationGuide.definition && implementationGuide.definition.page) {
            const autoGenerateExtension = _.find(implementationGuide.definition.page.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-page-auto-generate-toc');
            shouldAutoGenerate = autoGenerateExtension && autoGenerateExtension.valueBoolean === true;
            const pagesPath = path.join(rootPath, 'source/pages');
            fs.ensureDirSync(pagesPath);
            if (implementationGuide.definition.page.nameReference) {
                const nameReference = implementationGuide.definition.page.nameReference;
                if (nameReference.reference && nameReference.reference.startsWith('#')) {
                    const foundContained = _.find(implementationGuide.contained, (contained) => contained.id === nameReference.reference.substring(1));
                    const binary = foundContained && foundContained.resourceType === 'Binary' ? foundContained : undefined;
                    if (binary) {
                        rootPageContent = new Buffer(binary.data, 'base64').toString();
                        rootPageFileName = implementationGuide.definition.page.title.replace(/ /g, '_');
                        if (!rootPageFileName.endsWith('.md')) {
                            rootPageFileName += '.md';
                        }
                    }
                }
            }
            this.writeR4Page(pagesPath, implementationGuide, implementationGuide.definition.page, 1, tocEntries);
        }
        // Append TOC Entries to the toc.md file in the template
        this.generateTableOfContents(rootPath, tocEntries, shouldAutoGenerate, { fileName: rootPageFileName, content: rootPageContent });
    }
    export(format, executeIgPublisher, useTerminologyServer, useLatest, downloadOutput, includeIgPublisherJar, testCallback) {
        return new Promise((resolve, reject) => {
            const bundleExporter = new bundle_1.BundleExporter(this.fhirServerBase, this.fhirServerId, this.fhirVersion, this.fhir, this.implementationGuideId);
            const isXml = format === 'xml' || format === 'application/xml' || format === 'application/fhir+xml';
            const extension = (!isXml ? '.json' : '.xml');
            const homedir = require('os').homedir();
            const fhirServerConfig = _.find(fhirConfig.servers, (server) => server.id === this.fhirServerId);
            let control;
            let implementationGuideResource;
            tmp.dir((tmpDirErr, rootPath) => {
                if (tmpDirErr) {
                    this.log.error(tmpDirErr);
                    return reject('An error occurred while creating a temporary directory: ' + tmpDirErr);
                }
                const controlPath = path.join(rootPath, 'ig.json');
                let bundle;
                this.packageId = rootPath.substring(rootPath.lastIndexOf(path.sep) + 1);
                resolve(this.packageId);
                setTimeout(() => {
                    this.sendSocketMessage('progress', 'Created temp directory. Retrieving resources for implementation guide.');
                    // Prepare IG Publisher package
                    bundleExporter.getBundle(false)
                        .then((results) => {
                        bundle = results;
                        const resourcesDir = path.join(rootPath, 'source/resources');
                        this.sendSocketMessage('progress', 'Resources retrieved. Packaging.');
                        for (let i = 0; i < bundle.entry.length; i++) {
                            const resource = bundle.entry[i].resource;
                            const extensionlessResource = bundle_1.BundleExporter.removeExtensions(resource);
                            const resourceType = resource.resourceType;
                            const id = resource.id;
                            const resourceDir = path.join(resourcesDir, resourceType.toLowerCase());
                            let resourcePath;
                            let resourceContent = null;
                            if (resourceType === 'ImplementationGuide' && id === this.implementationGuideId) {
                                implementationGuideResource = resource;
                            }
                            // ImplementationGuide must be generated as an xml file for the IG Publisher in STU3.
                            if (!isXml && resourceType !== 'ImplementationGuide') {
                                resourceContent = JSON.stringify(extensionlessResource, null, '\t');
                                resourcePath = path.join(resourceDir, id + '.json');
                            }
                            else {
                                resourceContent = this.fhir.objToXml(extensionlessResource);
                                resourceContent = vkbeautify.xml(resourceContent);
                                resourcePath = path.join(resourceDir, id + '.xml');
                            }
                            fs.ensureDirSync(resourceDir);
                            fs.writeFileSync(resourcePath, resourceContent);
                        }
                        if (!implementationGuideResource) {
                            throw new Error('The implementation guide was not found in the bundle returned by the server');
                        }
                        if (fhirServerConfig.version === 'stu3') {
                            control = this.getStu3Control(implementationGuideResource, bundle, this.getFhirControlVersion(fhirServerConfig));
                        }
                        else {
                            control = this.getR4Control(implementationGuideResource, bundle, this.getFhirControlVersion(fhirServerConfig));
                        }
                        return this.getDependencies(control, isXml, resourcesDir, this.fhir, fhirServerConfig);
                    })
                        .then(() => {
                        // Copy the contents of the ig-publisher-template folder to the export temporary folder
                        const templatePath = path.join(__dirname, '../../', 'ig-publisher-template');
                        fs.copySync(templatePath, rootPath);
                        // Write the ig.json file to the export temporary folder
                        const controlContent = JSON.stringify(control, null, '\t');
                        fs.writeFileSync(controlPath, controlContent);
                        // Write the intro, summary and search MD files for each resource
                        _.each(bundle.entry, (entry) => this.writeFilesForResources(rootPath, entry.resource));
                        this.updateTemplates(rootPath, bundle, implementationGuideResource);
                        if (fhirServerConfig.version === 'stu3') {
                            this.writeStu3Pages(rootPath, implementationGuideResource);
                        }
                        else {
                            this.writeR4Pages(rootPath, implementationGuideResource);
                        }
                        this.sendSocketMessage('progress', 'Done building package');
                        return this.getIgPublisher(useLatest, executeIgPublisher);
                    })
                        .then((igPublisherLocation) => {
                        if (includeIgPublisherJar) {
                            this.sendSocketMessage('progress', 'Copying IG Publisher JAR to working directory.');
                            const jarFileName = igPublisherLocation.substring(igPublisherLocation.lastIndexOf(path.sep) + 1);
                            const destJarPath = path.join(rootPath, jarFileName);
                            fs.copySync(igPublisherLocation, destJarPath);
                        }
                        if (!executeIgPublisher || !igPublisherLocation) {
                            this.sendSocketMessage('complete', 'Done. You will be prompted to download the package in a moment.');
                            if (testCallback) {
                                testCallback(rootPath);
                            }
                            return;
                        }
                        const deployDir = path.resolve(__dirname, '../../wwwroot/igs', this.fhirServerId, implementationGuideResource.id);
                        fs.ensureDirSync(deployDir);
                        const igPublisherVersion = useLatest ? 'latest' : 'default';
                        const process = serverConfig.javaLocation || 'java';
                        const jarParams = ['-jar', igPublisherLocation, '-ig', controlPath];
                        if (!useTerminologyServer) {
                            jarParams.push('-tx', 'N/A');
                        }
                        this.sendSocketMessage('progress', `Running ${igPublisherVersion} IG Publisher: ${jarParams.join(' ')}`);
                        this.log.debug(`Spawning FHIR IG Publisher Java process at ${process} with params ${jarParams}`);
                        const igPublisherProcess = child_process_1.spawn(process, jarParams);
                        igPublisherProcess.stdout.on('data', (data) => {
                            const message = data.toString().replace(tmp.tmpdir, 'XXX').replace(homedir, 'XXX');
                            if (message && message.trim().replace(/\./g, '') !== '') {
                                this.sendSocketMessage('progress', message);
                            }
                        });
                        igPublisherProcess.stderr.on('data', (data) => {
                            const message = data.toString().replace(tmp.tmpdir, 'XXX').replace(homedir, 'XXX');
                            if (message && message.trim().replace(/\./g, '') !== '') {
                                this.sendSocketMessage('progress', message);
                            }
                        });
                        igPublisherProcess.on('error', (err) => {
                            const message = 'Error executing FHIR IG Publisher: ' + err;
                            this.log.error(message);
                            this.sendSocketMessage('error', message);
                        });
                        igPublisherProcess.on('exit', (code) => {
                            this.log.debug(`IG Publisher is done executing for ${rootPath}`);
                            this.sendSocketMessage('progress', 'IG Publisher finished with code ' + code);
                            if (code !== 0) {
                                this.sendSocketMessage('progress', 'Won\'t copy output to deployment path.');
                                this.sendSocketMessage('complete', 'Done. You will be prompted to download the package in a moment.');
                            }
                            else {
                                this.sendSocketMessage('progress', 'Copying output to deployment path.');
                                const generatedPath = path.resolve(rootPath, 'generated_output');
                                const outputPath = path.resolve(rootPath, 'output');
                                this.log.debug(`Deleting content generated by ig publisher in ${generatedPath}`);
                                fs.emptyDir(generatedPath, (err) => {
                                    if (err) {
                                        this.log.error(err);
                                    }
                                });
                                this.log.debug(`Copying output from ${outputPath} to ${deployDir}`);
                                fs.copy(outputPath, deployDir, (err) => {
                                    if (err) {
                                        this.log.error(err);
                                        this.sendSocketMessage('error', 'Error copying contents to deployment path.');
                                    }
                                    else {
                                        const finalMessage = `Done executing the FHIR IG Publisher. You may view the IG <a href="/implementation-guide/${this.implementationGuideId}/view">here</a>.` + (downloadOutput ? ' You will be prompted to download the package in a moment.' : '');
                                        this.sendSocketMessage('complete', finalMessage);
                                    }
                                    if (!downloadOutput) {
                                        this.log.debug(`User indicated they don't need to download. Removing temporary directory ${rootPath}`);
                                        fs.emptyDir(rootPath, (err) => {
                                            if (err) {
                                                this.log.error(err);
                                            }
                                            else {
                                                this.log.debug(`Done removing temporary directory ${rootPath}`);
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    })
                        .catch((err) => {
                        this.log.error(err);
                        this.sendSocketMessage('error', 'Error during export: ' + err);
                        if (testCallback) {
                            testCallback(rootPath, err);
                        }
                    });
                }, 1000);
            });
        });
    }
}
exports.HtmlExporter = HtmlExporter;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaHRtbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImh0bWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQSxpREFBb0M7QUFlcEMsaUNBQWlDO0FBQ2pDLDZCQUE2QjtBQUM3QixnQ0FBZ0M7QUFDaEMsc0NBQXNDO0FBQ3RDLCtCQUErQjtBQUMvQixpQ0FBaUM7QUFDakMsMkJBQTJCO0FBQzNCLHlDQUF5QztBQVN6QyxxQ0FBd0M7QUFFeEMsbURBQThDO0FBRTlDLE1BQU0sVUFBVSxHQUFnQixNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ25ELE1BQU0sWUFBWSxHQUFrQixNQUFNLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBUXpELE1BQWEsWUFBWTtJQVlyQixZQUFZLGNBQXNCLEVBQUUsWUFBb0IsRUFBRSxXQUFtQixFQUFFLElBQWdCLEVBQUUsRUFBVSxFQUFFLFFBQWdCLEVBQUUscUJBQTZCO1FBWG5KLFFBQUcsR0FBRyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7UUFZOUIsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUM7UUFDckMsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUM7UUFDakMsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUM7UUFDL0IsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUM7UUFDYixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUN6QixJQUFJLENBQUMscUJBQXFCLEdBQUcscUJBQXFCLENBQUM7SUFDdkQsQ0FBQztJQUVPLGNBQWMsQ0FBQyxJQUFzQjtRQUN6QyxJQUFJLENBQUMsSUFBSSxFQUFFO1lBQ1AsT0FBTztTQUNWO1FBRUQsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUU7WUFDMUIsT0FBZ0IsSUFBSSxDQUFDO1NBQ3hCO1FBRUQsSUFBSSxPQUFPLEdBQUcs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Q047d0JBQ0wsQ0FBQyxDQUFDLENBQUM7b0JBQ1AsQ0FBQyxDQUFDO3lCQUNELEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFO3dCQUNYLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3dCQUNwQixJQUFJLENBQUMsaUJBQWlCLENBQUMsT0FBTyxFQUFFLHVCQUF1QixHQUFHLEdBQUcsQ0FBQyxDQUFDO3dCQUUvRCxJQUFJLFlBQVksRUFBRTs0QkFDZCxZQUFZLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO3lCQUMvQjtvQkFDTCxDQUFDLENBQUMsQ0FBQztnQkFDWCxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDYixDQUFDLENBQUMsQ0FBQztRQUNQLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBMzdCRCxvQ0EyN0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtGaGlyIGFzIEZoaXJNb2R1bGV9IGZyb20gJ2ZoaXIvZmhpcic7XG5pbXBvcnQge1NlcnZlcn0gZnJvbSAnc29ja2V0LmlvJztcbmltcG9ydCB7c3Bhd259IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHtcbiAgICBEb21haW5SZXNvdXJjZSxcbiAgICBIdW1hbk5hbWUsXG4gICAgQnVuZGxlIGFzIFNUVTNCdW5kbGUsXG4gICAgQmluYXJ5IGFzIFNUVTNCaW5hcnksXG4gICAgSW1wbGVtZW50YXRpb25HdWlkZSBhcyBTVFUzSW1wbGVtZW50YXRpb25HdWlkZSxcbiAgICBQYWdlQ29tcG9uZW50LCBFeHRlbnNpb25cbn0gZnJvbSAnLi4vLi4vc3JjL2FwcC9tb2RlbHMvc3R1My9maGlyJztcbmltcG9ydCB7XG4gICAgQmluYXJ5IGFzIFI0QmluYXJ5LFxuICAgIEJ1bmRsZSBhcyBSNEJ1bmRsZSxcbiAgICBJbXBsZW1lbnRhdGlvbkd1aWRlIGFzIFI0SW1wbGVtZW50YXRpb25HdWlkZSxcbiAgICBJbXBsZW1lbnRhdGlvbkd1aWRlUGFnZUNvbXBvbmVudFxufSBmcm9tICcuLi8uLi9zcmMvYXBwL21vZGVscy9yNC9maGlyJztcbmltcG9ydCAqIGFzIGxvZzRqcyBmcm9tICdsb2c0anMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIF8gZnJvbSAndW5kZXJzY29yZSc7XG5pbXBvcnQgKiBhcyBycCBmcm9tICdyZXF1ZXN0LXByb21pc2UnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0ICogYXMgY29uZmlnIGZyb20gJ2NvbmZpZyc7XG5pbXBvcnQgKiBhcyB0bXAgZnJvbSAndG1wJztcbmltcG9ydCAqIGFzIHZrYmVhdXRpZnkgZnJvbSAndmtiZWF1dGlmeSc7XG5pbXBvcnQge1xuICAgIEZoaXIsXG4gICAgRmhpckNvbmZpZyxcbiAgICBGaGlyQ29uZmlnU2VydmVyLFxuICAgIEZoaXJDb250cm9sLFxuICAgIEZoaXJDb250cm9sRGVwZW5kZW5jeSxcbiAgICBTZXJ2ZXJDb25maWdcbn0gZnJvbSAnLi4vY29udHJvbGxlcnMvbW9kZWxzJztcbmltcG9ydCB7QnVuZGxlRXhwb3J0ZXJ9IGZyb20gJy4vYnVuZGxlJztcbmltcG9ydCBCdW5kbGUgPSBGaGlyLkJ1bmRsZTtcbmltcG9ydCB7R2xvYmFsc30gZnJvbSAnLi4vLi4vc3JjL2FwcC9nbG9iYWxzJztcblxuY29uc3QgZmhpckNvbmZpZyA9IDxGaGlyQ29uZmlnPiBjb25maWcuZ2V0KCdmaGlyJyk7XG5jb25zdCBzZXJ2ZXJDb25maWcgPSA8U2VydmVyQ29uZmlnPiBjb25maWcuZ2V0KCdzZXJ2ZXInKTtcblxuaW50ZXJmYWNlIFRhYmxlT2ZDb250ZW50c0VudHJ5IHtcbiAgICBsZXZlbDogbnVtYmVyO1xuICAgIGZpbGVOYW1lOiBzdHJpbmc7XG4gICAgdGl0bGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEh0bWxFeHBvcnRlciB7XG4gICAgcmVhZG9ubHkgbG9nID0gbG9nNGpzLmdldExvZ2dlcigpO1xuICAgIHJlYWRvbmx5IGZoaXJTZXJ2ZXJCYXNlOiBzdHJpbmc7XG4gICAgcmVhZG9ubHkgZmhpclNlcnZlcklkOiBzdHJpbmc7XG4gICAgcmVhZG9ubHkgZmhpclZlcnNpb246IHN0cmluZztcbiAgICByZWFkb25seSBmaGlyOiBGaGlyTW9kdWxlO1xuICAgIHJlYWRvbmx5IGlvOiBTZXJ2ZXI7XG4gICAgcmVhZG9ubHkgc29ja2V0SWQ6IHN0cmluZztcbiAgICByZWFkb25seSBpbXBsZW1lbnRhdGlvbkd1aWRlSWQ6IHN0cmluZztcblxuICAgIHByaXZhdGUgcGFja2FnZUlkOiBzdHJpbmc7XG5cbiAgICBjb25zdHJ1Y3RvcihmaGlyU2VydmVyQmFzZTogc3RyaW5nLCBmaGlyU2VydmVySWQ6IHN0cmluZywgZmhpclZlcnNpb246IHN0cmluZywgZmhpcjogRmhpck1vZHVsZSwgaW86IFNlcnZlciwgc29ja2V0SWQ6IHN0cmluZywgaW1wbGVtZW50YXRpb25HdWlkZUlkOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5maGlyU2VydmVyQmFzZSA9IGZoaXJTZXJ2ZXJCYXNlO1xuICAgICAgICB0aGlzLmZoaXJTZXJ2ZXJJZCA9IGZoaXJTZXJ2ZXJJZDtcbiAgICAgICAgdGhpcy5maGlyVmVyc2lvbiA9IGZoaXJWZXJzaW9uO1xuICAgICAgICB0aGlzLmZoaXIgPSBmaGlyO1xuICAgICAgICB0aGlzLmlvID0gaW87XG4gICAgICAgIHRoaXMuc29ja2V0SWQgPSBzb2NrZXRJZDtcbiAgICAgICAgdGhpcy5pbXBsZW1lbnRhdGlvbkd1aWRlSWQgPSBpbXBsZW1lbnRhdGlvbkd1aWRlSWQ7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXREaXNwbGF5TmFtZShuYW1lOiBzdHJpbmd8SHVtYW5OYW1lKTogc3RyaW5nIHtcbiAgICAgICAgaWYgKCFuYW1lKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIG5hbWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4gPHN0cmluZz4gbmFtZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBkaXNwbGF5ID0gbmFtZS5mYW1pbHk7XG5cbiAgICAgICAgaWYgKG5hbWUuZ2l2ZW4pIHtcbiAgICAgICAgICAgIGlmIChkaXNwbGF5KSB7XG4gICAgICAgICAgICAgICAgZGlzcGxheSArPSAnLCAnO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBkaXNwbGF5ID0gJyc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGRpc3BsYXkgKz0gbmFtZS5naXZlbi5qb2luKCcgJyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZGlzcGxheTtcbiAgICB9XG5cblxuICAgIHByaXZhdGUgY3JlYXRlVGFibGVGcm9tQXJyYXkoaGVhZGVycywgZGF0YSkge1xuICAgICAgICBsZXQgb3V0cHV0ID0gJzx0YWJsZT5cXG48dGhlYWQ+XFxuPHRyPlxcbic7XG5cbiAgICAgICAgXy5lYWNoKGhlYWRlcnMsIChoZWFkZXIpID0+IHtcbiAgICAgICAgICAgIG91dHB1dCArPSBgPHRoPiR7aGVhZGVyfTwvdGg+XFxuYDtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgb3V0cHV0ICs9ICc8L3RyPlxcbjwvdGhlYWQ+XFxuPHRib2R5Plxcbic7XG5cbiAgICAgICAgXy5lYWNoKGRhdGEsIChyb3c6IHN0cmluZ1tdKSA9PiB7XG4gICAgICAgICAgICBvdXRwdXQgKz0gJzx0cj5cXG4nO1xuXG4gICAgICAgICAgICBfLmVhY2gocm93LCAoY2VsbCkgPT4ge1xuICAgICAgICAgICAgICAgIG91dHB1dCArPSBgPHRkPiR7Y2VsbH08L3RkPlxcbmA7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgb3V0cHV0ICs9ICc8L3RyPlxcbic7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIG91dHB1dCArPSAnPC90Ym9keT5cXG48L3RhYmxlPlxcbic7XG5cbiAgICAgICAgcmV0dXJuIG91dHB1dDtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNlbmRTb2NrZXRNZXNzYWdlKHN0YXR1cywgbWVzc2FnZSkge1xuICAgICAgICBpZiAoIXRoaXMuc29ja2V0SWQpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdXb25cXCd0IHNlbmQgc29ja2V0IG1lc3NhZ2UgZm9yIGV4cG9ydCBiZWNhdXNlIHRoZSBvcmlnaW5hbCByZXF1ZXN0IGRpZCBub3Qgc3BlY2lmeSBhIHNvY2tldElkJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5pbykge1xuICAgICAgICAgICAgdGhpcy5pby50byh0aGlzLnNvY2tldElkKS5lbWl0KCdodG1sLWV4cG9ydCcsIHtcbiAgICAgICAgICAgICAgICBwYWNrYWdlSWQ6IHRoaXMucGFja2FnZUlkLFxuICAgICAgICAgICAgICAgIHN0YXR1czogc3RhdHVzLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IG1lc3NhZ2VcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRJZ1B1Ymxpc2hlcih1c2VMYXRlc3Q6IGJvb2xlYW4sIGV4ZWN1dGVJZ1B1Ymxpc2hlcjogYm9vbGVhbik6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgICAgIGlmICghZXhlY3V0ZUlnUHVibGlzaGVyKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gJ29yZy5obDcuZmhpci5pZ3B1Ymxpc2hlci5qYXInO1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vaWctcHVibGlzaGVyJyk7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0RmlsZVBhdGggPSBwYXRoLmpvaW4oZGVmYXVsdFBhdGgsIGZpbGVOYW1lKTtcblxuICAgICAgICAgICAgaWYgKHVzZUxhdGVzdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdSZXF1ZXN0IHRvIGdldCBsYXRlc3QgdmVyc2lvbiBvZiBGSElSIElHIHB1Ymxpc2hlci4gUmV0cmlldmluZyBmcm9tOiAnICsgZmhpckNvbmZpZy5sYXRlc3RQdWJsaXNoZXIpO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgncHJvZ3Jlc3MnLCAnRG93bmxvYWRpbmcgbGF0ZXN0IEZISVIgSUcgcHVibGlzaGVyJyk7XG5cbiAgICAgICAgICAgICAgICAvLyBUT0RPOiBDaGVjayBodHRwOi8vYnVpbGQuZmhpci5vcmcvdmVyc2lvbi5pbmZvIGZpcnN0XG5cbiAgICAgICAgICAgICAgICBycChmaGlyQ29uZmlnLmxhdGVzdFB1Ymxpc2hlciwgeyBlbmNvZGluZzogbnVsbCB9KVxuICAgICAgICAgICAgICAgICAgICAudGhlbigocmVzdWx0cykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ1N1Y2Nlc3NmdWxseSBkb3dubG9hZGVkIGxhdGVzdCB2ZXJzaW9uIG9mIEZISVIgSUcgUHVibGlzaGVyLiBFbnN1cmluZyBsYXRlc3QgZGlyZWN0b3J5IGV4aXN0cycpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXRlc3RQYXRoID0gcGF0aC5qb2luKGRlZmF1bHRQYXRoLCAnbGF0ZXN0Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBmcy5lbnN1cmVEaXJTeW5jKGxhdGVzdFBhdGgpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBub2luc3BlY3Rpb24gSlNVbnJlc29sdmVkRnVuY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJ1ZmYgPSBCdWZmZXIuZnJvbShyZXN1bHRzLCAndXRmOCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF0ZXN0RmlsZVBhdGggPSBwYXRoLmpvaW4obGF0ZXN0UGF0aCwgZmlsZU5hbWUpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnU2F2aW5nIEZISVIgSUcgcHVibGlzaGVyIHRvICcgKyBsYXRlc3RGaWxlUGF0aCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMobGF0ZXN0RmlsZVBhdGgsIGJ1ZmYpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKGxhdGVzdEZpbGVQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgLmNhdGNoKChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKGBFcnJvciBnZXR0aW5nIGxhdGVzdCB2ZXJzaW9uIG9mIEZISVIgSUcgcHVibGlzaGVyOiAke2Vycn1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ0VuY291bnRlcmVkIGVycm9yIGRvd25sb2FkaW5nIGxhdGVzdCBJRyBwdWJsaXNoZXIsIHdpbGwgdXNlIHByZS1sb2FkZWQvZGVmYXVsdCBJRyBwdWJsaXNoZXInKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoZGVmYXVsdEZpbGVQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdVc2luZyBidWlsdC1pbiB2ZXJzaW9uIG9mIEZISVIgSUcgcHVibGlzaGVyIGZvciBleHBvcnQnKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsICdVc2luZyBleGlzdGluZy9kZWZhdWx0IHZlcnNpb24gb2YgRkhJUiBJRyBwdWJsaXNoZXInKTtcbiAgICAgICAgICAgICAgICByZXNvbHZlKGRlZmF1bHRGaWxlUGF0aCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIGNvcHlFeHRlbnNpb24oZGVzdEV4dGVuc2lvbnNEaXI6IHN0cmluZywgZXh0ZW5zaW9uRmlsZU5hbWU6IHN0cmluZywgaXNYbWw6IGJvb2xlYW4sIGZoaXI6IEZoaXJNb2R1bGUpIHtcbiAgICAgICAgY29uc3Qgc291cmNlRXh0ZW5zaW9uc0RpciA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9zcmMvYXNzZXRzL3N0dTMvZXh0ZW5zaW9ucycpO1xuICAgICAgICBjb25zdCBzb3VyY2VFeHRlbnNpb25GaWxlTmFtZSA9IHBhdGguam9pbihzb3VyY2VFeHRlbnNpb25zRGlyLCBleHRlbnNpb25GaWxlTmFtZSk7XG4gICAgICAgIGxldCBkZXN0RXh0ZW5zaW9uRmlsZU5hbWUgPSBwYXRoLmpvaW4oZGVzdEV4dGVuc2lvbnNEaXIsIGV4dGVuc2lvbkZpbGVOYW1lKTtcblxuICAgICAgICBpZiAoIWlzWG1sKSB7XG4gICAgICAgICAgICBmcy5jb3B5U3luYyhzb3VyY2VFeHRlbnNpb25GaWxlTmFtZSwgZGVzdEV4dGVuc2lvbkZpbGVOYW1lKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGV4dGVuc2lvbkpzb24gPSBmcy5yZWFkRmlsZVN5bmMoc291cmNlRXh0ZW5zaW9uRmlsZU5hbWUpLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICBjb25zdCBleHRlbnNpb25YbWwgPSBmaGlyLmpzb25Ub1htbChleHRlbnNpb25Kc29uKTtcblxuICAgICAgICAgICAgZGVzdEV4dGVuc2lvbkZpbGVOYW1lID0gZGVzdEV4dGVuc2lvbkZpbGVOYW1lLnN1YnN0cmluZygwLCBkZXN0RXh0ZW5zaW9uRmlsZU5hbWUuaW5kZXhPZignLmpzb24nKSkgKyAnLnhtbCc7XG4gICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKGRlc3RFeHRlbnNpb25GaWxlTmFtZSwgZXh0ZW5zaW9uWG1sKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIGdldERlcGVuZGVuY2llcyhjb250cm9sLCBpc1htbDogYm9vbGVhbiwgcmVzb3VyY2VzRGlyOiBzdHJpbmcsIGZoaXI6IEZoaXJNb2R1bGUsIGZoaXJTZXJ2ZXJDb25maWc6IEZoaXJDb25maWdTZXJ2ZXIpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICBjb25zdCBpc1N0dTMgPSBmaGlyU2VydmVyQ29uZmlnICYmIGZoaXJTZXJ2ZXJDb25maWcudmVyc2lvbiA9PT0gJ3N0dTMnO1xuXG4gICAgICAgIC8vIExvYWQgdGhlIGlnIGRlcGVuZGVuY3kgZXh0ZW5zaW9ucyBpbnRvIHRoZSByZXNvdXJjZXMgZGlyZWN0b3J5XG4gICAgICAgIGlmIChpc1N0dTMgJiYgY29udHJvbC5kZXBlbmRlbmN5TGlzdCAmJiBjb250cm9sLmRlcGVuZGVuY3lMaXN0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGRlc3RFeHRlbnNpb25zRGlyID0gcGF0aC5qb2luKHJlc291cmNlc0RpciwgJ3N0cnVjdHVyZWRlZmluaXRpb24nKTtcblxuICAgICAgICAgICAgZnMuZW5zdXJlRGlyU3luYyhkZXN0RXh0ZW5zaW9uc0Rpcik7XG5cbiAgICAgICAgICAgIHRoaXMuY29weUV4dGVuc2lvbihkZXN0RXh0ZW5zaW9uc0RpciwgJ2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5Lmpzb24nLCBpc1htbCwgZmhpcik7XG4gICAgICAgICAgICB0aGlzLmNvcHlFeHRlbnNpb24oZGVzdEV4dGVuc2lvbnNEaXIsICdleHRlbnNpb24taWctZGVwZW5kZW5jeS12ZXJzaW9uLmpzb24nLCBpc1htbCwgZmhpcik7XG4gICAgICAgICAgICB0aGlzLmNvcHlFeHRlbnNpb24oZGVzdEV4dGVuc2lvbnNEaXIsICdleHRlbnNpb24taWctZGVwZW5kZW5jeS1sb2NhdGlvbi5qc29uJywgaXNYbWwsIGZoaXIpO1xuICAgICAgICAgICAgdGhpcy5jb3B5RXh0ZW5zaW9uKGRlc3RFeHRlbnNpb25zRGlyLCAnZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3ktbmFtZS5qc29uJywgaXNYbWwsIGZoaXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShbXSk7ICAgICAgICAgICAvLyBUaGlzIGlzbid0IGFjdHVhbGx5IG5lZWRlZCwgc2luY2UgdGhlIElHIFB1Ymxpc2hlciBhdHRlbXB0cyB0byByZXNvbHZlIHRoZXNlIGRlcGVuZGVuY3kgYXV0b21hdGljYWxseVxuXG4gICAgICAgIC8qXG4gICAgICAgIC8vIEF0dGVtcHQgdG8gcmVzb2x2ZSB0aGUgZGVwZW5kZW5jeSdzIGRlZmluaXRpb25zIGFuZCBpbmNsdWRlIGl0IGluIHRoZSBwYWNrYWdlXG4gICAgICAgIGNvbnN0IGRlZmVycmVkID0gUS5kZWZlcigpO1xuICAgICAgICBjb25zdCBwcm9taXNlcyA9IF8ubWFwKGNvbnRyb2wuZGVwZW5kZW5jeUxpc3QsIChkZXBlbmRlbmN5KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZXBlbmRlbmN5VXJsID1cbiAgICAgICAgICAgICAgICBkZXBlbmRlbmN5LmxvY2F0aW9uICtcbiAgICAgICAgICAgICAgICAoZGVwZW5kZW5jeS5sb2NhdGlvbi5lbmRzV2l0aCgnLycpID8gJycgOiAnLycpICsgJ2RlZmluaXRpb25zLicgK1xuICAgICAgICAgICAgICAgIChpc1htbCA/ICd4bWwnIDogJ2pzb24nKSArXG4gICAgICAgICAgICAgICAgJy56aXAnO1xuICAgICAgICAgICAgcmV0dXJuIGdldERlcGVuZGVuY3koZGVwZW5kZW5jeVVybCwgZGVwZW5kZW5jeS5uYW1lKTtcbiAgICAgICAgfSk7XG4gICAgXG4gICAgICAgIFEuYWxsKHByb21pc2VzKVxuICAgICAgICAgICAgLnRoZW4oZGVmZXJyZWQucmVzb2x2ZSlcbiAgICAgICAgICAgIC5jYXRjaChkZWZlcnJlZC5yZWplY3QpO1xuICAgIFxuICAgICAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcbiAgICAgICAgKi9cbiAgICB9XG4gICAgXG4gICAgcHJpdmF0ZSBnZXRGaGlyQ29udHJvbFZlcnNpb24oZmhpclNlcnZlckNvbmZpZykge1xuICAgICAgICBjb25zdCBjb25maWdWZXJzaW9uID0gZmhpclNlcnZlckNvbmZpZyA/IGZoaXJTZXJ2ZXJDb25maWcudmVyc2lvbiA6IG51bGw7XG5cbiAgICAgICAgLy8gVE9ETzogQWRkIG1vcmUgbG9naWNcbiAgICAgICAgc3dpdGNoIChjb25maWdWZXJzaW9uKSB7XG4gICAgICAgICAgICBjYXNlICdzdHUzJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gJzMuMC4xJztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuICc0LjAuMCc7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcHJpdmF0ZSB1cGRhdGVUZW1wbGF0ZXMocm9vdFBhdGgsIGJ1bmRsZSwgaW1wbGVtZW50YXRpb25HdWlkZTogU1RVM0ltcGxlbWVudGF0aW9uR3VpZGUpIHtcbiAgICAgICAgY29uc3QgbWFpblJlc291cmNlVHlwZXMgPSBbJ0ltcGxlbWVudGF0aW9uR3VpZGUnLCAnVmFsdWVTZXQnLCAnQ29kZVN5c3RlbScsICdTdHJ1Y3R1cmVEZWZpbml0aW9uJywgJ0NhcGFiaWxpdHlTdGF0ZW1lbnQnXTtcbiAgICAgICAgY29uc3QgZGlzdGluY3RSZXNvdXJjZXMgPSBfLmNoYWluKGJ1bmRsZS5lbnRyeSlcbiAgICAgICAgICAgIC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5yZXNvdXJjZSlcbiAgICAgICAgICAgIC51bmlxKChyZXNvdXJjZSkgPT4gcmVzb3VyY2UuaWQpXG4gICAgICAgICAgICAudmFsdWUoKTtcbiAgICAgICAgY29uc3QgdmFsdWVTZXRzID0gXy5maWx0ZXIoZGlzdGluY3RSZXNvdXJjZXMsIChyZXNvdXJjZSkgPT4gcmVzb3VyY2UucmVzb3VyY2VUeXBlID09PSAnVmFsdWVTZXQnKTtcbiAgICAgICAgY29uc3QgY29kZVN5c3RlbXMgPSBfLmZpbHRlcihkaXN0aW5jdFJlc291cmNlcywgKHJlc291cmNlKSA9PiByZXNvdXJjZS5yZXNvdXJjZVR5cGUgPT09ICdDb2RlU3lzdGVtJyk7XG4gICAgICAgIGNvbnN0IHByb2ZpbGVzID0gXy5maWx0ZXIoZGlzdGluY3RSZXNvdXJjZXMsIChyZXNvdXJjZSkgPT4gcmVzb3VyY2UucmVzb3VyY2VUeXBlID09PSAnU3RydWN0dXJlRGVmaW5pdGlvbicgJiYgKCFyZXNvdXJjZS5iYXNlRGVmaW5pdGlvbiB8fCAhcmVzb3VyY2UuYmFzZURlZmluaXRpb24uZW5kc1dpdGgoJ0V4dGVuc2lvbicpKSk7XG4gICAgICAgIGNvbnN0IGV4dGVuc2lvbnMgPSBfLmZpbHRlcihkaXN0aW5jdFJlc291cmNlcywgKHJlc291cmNlKSA9PiByZXNvdXJjZS5yZXNvdXJjZVR5cGUgPT09ICdTdHJ1Y3R1cmVEZWZpbml0aW9uJyAmJiByZXNvdXJjZS5iYXNlRGVmaW5pdGlvbiAmJiByZXNvdXJjZS5iYXNlRGVmaW5pdGlvbi5lbmRzV2l0aCgnRXh0ZW5zaW9uJykpO1xuICAgICAgICBjb25zdCBjYXBhYmlsaXR5U3RhdGVtZW50cyA9IF8uZmlsdGVyKGRpc3RpbmN0UmVzb3VyY2VzLCAocmVzb3VyY2UpID0+IHJlc291cmNlLnJlc291cmNlVHlwZSA9PT0gJ0NhcGFiaWxpdHlTdGF0ZW1lbnQnKTtcbiAgICAgICAgY29uc3Qgb3RoZXJSZXNvdXJjZXMgPSBfLmZpbHRlcihkaXN0aW5jdFJlc291cmNlcywgKHJlc291cmNlKSA9PiBtYWluUmVzb3VyY2VUeXBlcy5pbmRleE9mKHJlc291cmNlLnJlc291cmNlVHlwZSkgPCAwKTtcblxuICAgICAgICBpZiAoaW1wbGVtZW50YXRpb25HdWlkZSkge1xuICAgICAgICAgICAgY29uc3QgaW5kZXhQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL2luZGV4Lm1kJyk7XG5cbiAgICAgICAgICAgIGlmIChpbXBsZW1lbnRhdGlvbkd1aWRlLmRlc2NyaXB0aW9uKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZGVzY3JpcHRpb25Db250ZW50ID0gJyMjIyBEZXNjcmlwdGlvblxcblxcbicgKyBpbXBsZW1lbnRhdGlvbkd1aWRlLmRlc2NyaXB0aW9uICsgJ1xcblxcbic7XG4gICAgICAgICAgICAgICAgZnMuYXBwZW5kRmlsZVN5bmMoaW5kZXhQYXRoLCBkZXNjcmlwdGlvbkNvbnRlbnQpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoaW1wbGVtZW50YXRpb25HdWlkZS5jb250YWN0KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYXV0aG9yc0RhdGEgPSBfLm1hcChpbXBsZW1lbnRhdGlvbkd1aWRlLmNvbnRhY3QsIChjb250YWN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvdW5kRW1haWwgPSBfLmZpbmQoY29udGFjdC50ZWxlY29tLCAodGVsZWNvbSkgPT4gdGVsZWNvbS5zeXN0ZW0gPT09ICdlbWFpbCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW2NvbnRhY3QubmFtZSwgZm91bmRFbWFpbCA/IGA8YSBocmVmPVwibWFpbHRvOiR7Zm91bmRFbWFpbC52YWx1ZX1cIj4ke2ZvdW5kRW1haWwudmFsdWV9PC9hPmAgOiAnJ107XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29uc3QgYXV0aG9yc0NvbnRlbnQgPSAnIyMjIEF1dGhvcnNcXG5cXG4nICsgdGhpcy5jcmVhdGVUYWJsZUZyb21BcnJheShbJ05hbWUnLCAnRW1haWwnXSwgYXV0aG9yc0RhdGEpICsgJ1xcblxcbic7XG4gICAgICAgICAgICAgICAgZnMuYXBwZW5kRmlsZVN5bmMoaW5kZXhQYXRoLCBhdXRob3JzQ29udGVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocHJvZmlsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgcHJvZmlsZXNEYXRhID0gXy5jaGFpbihwcm9maWxlcylcbiAgICAgICAgICAgICAgICAuc29ydEJ5KChwcm9maWxlKSA9PiBwcm9maWxlLm5hbWUpXG4gICAgICAgICAgICAgICAgLm1hcCgocHJvZmlsZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW2A8YSBocmVmPVwiU3RydWN0dXJlRGVmaW5pdGlvbi0ke3Byb2ZpbGUuaWR9Lmh0bWxcIj4ke3Byb2ZpbGUubmFtZX08L2E+YCwgcHJvZmlsZS5kZXNjcmlwdGlvbiB8fCAnJ107XG4gICAgICAgICAgICAgICAgfSkudmFsdWUoKTtcbiAgICAgICAgICAgIGNvbnN0IHByb2ZpbGVzVGFibGUgPSB0aGlzLmNyZWF0ZVRhYmxlRnJvbUFycmF5KFsnTmFtZScsICdEZXNjcmlwdGlvbiddLCBwcm9maWxlc0RhdGEpO1xuICAgICAgICAgICAgY29uc3QgcHJvZmlsZXNQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL3Byb2ZpbGVzLm1kJyk7XG4gICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyhwcm9maWxlc1BhdGgsICcjIyMgUHJvZmlsZXNcXG5cXG4nICsgcHJvZmlsZXNUYWJsZSArICdcXG5cXG4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChleHRlbnNpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGV4dERhdGEgPSBfLmNoYWluKGV4dGVuc2lvbnMpXG4gICAgICAgICAgICAgICAgLnNvcnRCeSgoZXh0ZW5zaW9uKSA9PiBleHRlbnNpb24ubmFtZSlcbiAgICAgICAgICAgICAgICAubWFwKChleHRlbnNpb24pID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtgPGEgaHJlZj1cIlN0cnVjdHVyZURlZmluaXRpb24tJHtleHRlbnNpb24uaWR9Lmh0bWxcIj4ke2V4dGVuc2lvbi5uYW1lfTwvYT5gLCBleHRlbnNpb24uZGVzY3JpcHRpb24gfHwgJyddO1xuICAgICAgICAgICAgICAgIH0pLnZhbHVlKCk7XG4gICAgICAgICAgICBjb25zdCBleHRDb250ZW50ID0gdGhpcy5jcmVhdGVUYWJsZUZyb21BcnJheShbJ05hbWUnLCAnRGVzY3JpcHRpb24nXSwgZXh0RGF0YSk7XG4gICAgICAgICAgICBjb25zdCBleHRQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL3Byb2ZpbGVzLm1kJyk7XG4gICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyhleHRQYXRoLCAnIyMjIEV4dGVuc2lvbnNcXG5cXG4nICsgZXh0Q29udGVudCArICdcXG5cXG4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh2YWx1ZVNldHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgbGV0IHZzQ29udGVudCA9ICcjIyMgVmFsdWUgU2V0c1xcblxcbic7XG4gICAgICAgICAgICBjb25zdCB2c1BhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsICdzb3VyY2UvcGFnZXMvdGVybWlub2xvZ3kubWQnKTtcblxuICAgICAgICAgICAgXy5jaGFpbih2YWx1ZVNldHMpXG4gICAgICAgICAgICAgICAgLnNvcnRCeSgodmFsdWVTZXQpID0+IHZhbHVlU2V0LnRpdGxlIHx8IHZhbHVlU2V0Lm5hbWUpXG4gICAgICAgICAgICAgICAgLmVhY2goKHZhbHVlU2V0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHZzQ29udGVudCArPSBgLSBbJHt2YWx1ZVNldC50aXRsZSB8fCB2YWx1ZVNldC5uYW1lfV0oVmFsdWVTZXQtJHt2YWx1ZVNldC5pZH0uaHRtbClcXG5gO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyh2c1BhdGgsIHZzQ29udGVudCArICdcXG5cXG4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb2RlU3lzdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBsZXQgY3NDb250ZW50ID0gJyMjIyBDb2RlIFN5c3RlbXNcXG5cXG4nO1xuICAgICAgICAgICAgY29uc3QgY3NQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL3Rlcm1pbm9sb2d5Lm1kJyk7XG5cbiAgICAgICAgICAgIF8uY2hhaW4oY29kZVN5c3RlbXMpXG4gICAgICAgICAgICAgICAgLnNvcnRCeSgoY29kZVN5c3RlbSkgPT4gY29kZVN5c3RlbS50aXRsZSB8fCBjb2RlU3lzdGVtLm5hbWUpXG4gICAgICAgICAgICAgICAgLmVhY2goKGNvZGVTeXN0ZW0pID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY3NDb250ZW50ICs9IGAtIFske2NvZGVTeXN0ZW0udGl0bGUgfHwgY29kZVN5c3RlbS5uYW1lfV0oVmFsdWVTZXQtJHtjb2RlU3lzdGVtLmlkfS5odG1sKVxcbmA7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGZzLmFwcGVuZEZpbGVTeW5jKGNzUGF0aCwgY3NDb250ZW50ICsgJ1xcblxcbicpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNhcGFiaWxpdHlTdGF0ZW1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGNzRGF0YSA9IF8uY2hhaW4oY2FwYWJpbGl0eVN0YXRlbWVudHMpXG4gICAgICAgICAgICAgICAgLnNvcnRCeSgoY2FwYWJpbGl0eVN0YXRlbWVudCkgPT4gY2FwYWJpbGl0eVN0YXRlbWVudC5uYW1lKVxuICAgICAgICAgICAgICAgIC5tYXAoKGNhcGFiaWxpdHlTdGF0ZW1lbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtgPGEgaHJlZj1cIkNhcGFiaWxpdHlTdGF0ZW1lbnQtJHtjYXBhYmlsaXR5U3RhdGVtZW50LmlkfS5odG1sXCI+JHtjYXBhYmlsaXR5U3RhdGVtZW50Lm5hbWV9PC9hPmAsIGNhcGFiaWxpdHlTdGF0ZW1lbnQuZGVzY3JpcHRpb24gfHwgJyddO1xuICAgICAgICAgICAgICAgIH0pLnZhbHVlKCk7XG4gICAgICAgICAgICBjb25zdCBjc0NvbnRlbnQgPSB0aGlzLmNyZWF0ZVRhYmxlRnJvbUFycmF5KFsnTmFtZScsICdEZXNjcmlwdGlvbiddLCBjc0RhdGEpO1xuICAgICAgICAgICAgY29uc3QgY3NQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL2NhcHN0YXRlbWVudHMubWQnKTtcbiAgICAgICAgICAgIGZzLmFwcGVuZEZpbGVTeW5jKGNzUGF0aCwgJyMjIyBDYXBhYmlsaXR5U3RhdGVtZW50c1xcblxcbicgKyBjc0NvbnRlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG90aGVyUmVzb3VyY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IG9EYXRhID0gXy5jaGFpbihvdGhlclJlc291cmNlcylcbiAgICAgICAgICAgICAgICAuc29ydEJ5KChyZXNvdXJjZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgZGlzcGxheSA9IHJlc291cmNlLnRpdGxlIHx8IHRoaXMuZ2V0RGlzcGxheU5hbWUocmVzb3VyY2UubmFtZSkgfHwgcmVzb3VyY2UuaWQ7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZXNvdXJjZS5yZXNvdXJjZVR5cGUgKyBkaXNwbGF5O1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLm1hcCgocmVzb3VyY2UpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IG5hbWUgPSByZXNvdXJjZS50aXRsZSB8fCB0aGlzLmdldERpc3BsYXlOYW1lKHJlc291cmNlLm5hbWUpIHx8IHJlc291cmNlLmlkO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW3Jlc291cmNlLnJlc291cmNlVHlwZSwgYDxhIGhyZWY9XCIke3Jlc291cmNlLnJlc291cmNlVHlwZX0tJHtyZXNvdXJjZS5pZH0uaHRtbFwiPiR7bmFtZX08L2E+YF07XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAudmFsdWUoKTtcbiAgICAgICAgICAgIGNvbnN0IG9Db250ZW50ID0gdGhpcy5jcmVhdGVUYWJsZUZyb21BcnJheShbJ1R5cGUnLCAnTmFtZSddLCBvRGF0YSk7XG4gICAgICAgICAgICBjb25zdCBjc1BhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsICdzb3VyY2UvcGFnZXMvb3RoZXIubWQnKTtcbiAgICAgICAgICAgIGZzLmFwcGVuZEZpbGVTeW5jKGNzUGF0aCwgJyMjIyBPdGhlciBSZXNvdXJjZXNcXG5cXG4nICsgb0NvbnRlbnQpO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHByaXZhdGUgd3JpdGVGaWxlc0ZvclJlc291cmNlcyhyb290UGF0aDogc3RyaW5nLCByZXNvdXJjZTogRG9tYWluUmVzb3VyY2UpIHtcbiAgICAgICAgaWYgKCFyZXNvdXJjZSB8fCAhcmVzb3VyY2UucmVzb3VyY2VUeXBlIHx8IHJlc291cmNlLnJlc291cmNlVHlwZSA9PT0gJ0ltcGxlbWVudGF0aW9uR3VpZGUnKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbnRyb1BhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsIGBzb3VyY2UvcGFnZXMvX2luY2x1ZGVzLyR7cmVzb3VyY2UuaWR9LWludHJvLm1kYCk7XG4gICAgICAgIGNvbnN0IHNlYXJjaFBhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsIGBzb3VyY2UvcGFnZXMvX2luY2x1ZGVzLyR7cmVzb3VyY2UuaWR9LXNlYXJjaC5tZGApO1xuICAgICAgICBjb25zdCBzdW1tYXJ5UGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgYHNvdXJjZS9wYWdlcy9faW5jbHVkZXMvJHtyZXNvdXJjZS5pZH0tc3VtbWFyeS5tZGApO1xuXG4gICAgICAgIGxldCBpbnRybyA9ICctLS1cXG4nICtcbiAgICAgICAgICAgIGB0aXRsZTogJHtyZXNvdXJjZS5yZXNvdXJjZVR5cGV9LSR7cmVzb3VyY2UuaWR9LWludHJvXFxuYCArXG4gICAgICAgICAgICAnbGF5b3V0OiBkZWZhdWx0XFxuJyArXG4gICAgICAgICAgICBgYWN0aXZlOiAke3Jlc291cmNlLnJlc291cmNlVHlwZX0tJHtyZXNvdXJjZS5pZH0taW50cm9cXG5gICtcbiAgICAgICAgICAgICctLS1cXG5cXG4nO1xuXG4gICAgICAgIGlmICgoPGFueT5yZXNvdXJjZSkuZGVzY3JpcHRpb24pIHtcbiAgICAgICAgICAgIGludHJvICs9ICg8YW55PnJlc291cmNlKS5kZXNjcmlwdGlvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMoaW50cm9QYXRoLCBpbnRybyk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMoc2VhcmNoUGF0aCwgJ1RPRE8gLSBTZWFyY2gnKTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhzdW1tYXJ5UGF0aCwgJ1RPRE8gLSBTdW1tYXJ5Jyk7XG4gICAgfVxuICAgIFxuICAgIHByaXZhdGUgZ2V0U3R1M0NvbnRyb2woaW1wbGVtZW50YXRpb25HdWlkZTogU1RVM0ltcGxlbWVudGF0aW9uR3VpZGUsIGJ1bmRsZTogU1RVM0J1bmRsZSwgdmVyc2lvbikge1xuICAgICAgICBjb25zdCBjYW5vbmljYWxCYXNlUmVnZXggPSAvXiguKz8pXFwvSW1wbGVtZW50YXRpb25HdWlkZVxcLy4rJC9nbTtcbiAgICAgICAgY29uc3QgY2Fub25pY2FsQmFzZU1hdGNoID0gY2Fub25pY2FsQmFzZVJlZ2V4LmV4ZWMoaW1wbGVtZW50YXRpb25HdWlkZS51cmwpO1xuICAgICAgICBjb25zdCBwYWNrYWdlSWRFeHRlbnNpb24gPSBfLmZpbmQoaW1wbGVtZW50YXRpb25HdWlkZS5leHRlbnNpb24sIChleHRlbnNpb24pID0+IGV4dGVuc2lvbi51cmwgPT09IG5ldyBHbG9iYWxzKCkuZXh0ZW5zaW9uVXJsc1snZXh0ZW5zaW9uLWlnLXBhY2thZ2UtaWQnXSk7XG4gICAgICAgIGxldCBjYW5vbmljYWxCYXNlO1xuXG4gICAgICAgIGlmICghY2Fub25pY2FsQmFzZU1hdGNoIHx8IGNhbm9uaWNhbEJhc2VNYXRjaC5sZW5ndGggPCAyKSB7XG4gICAgICAgICAgICBjYW5vbmljYWxCYXNlID0gaW1wbGVtZW50YXRpb25HdWlkZS51cmwuc3Vic3RyaW5nKDAsIGltcGxlbWVudGF0aW9uR3VpZGUudXJsLmxhc3RJbmRleE9mKCcvJykpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2Fub25pY2FsQmFzZSA9IGNhbm9uaWNhbEJhc2VNYXRjaFsxXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRPRE86IEV4dHJhY3QgbnBtLW5hbWUgZnJvbSBJRyBleHRlbnNpb24uXG4gICAgICAgIC8vIGN1cnJlbnRseSwgSUcgcmVzb3VyY2UgaGFzIHRvIGJlIGluIFhNTCBmb3JtYXQgZm9yIHRoZSBJRyBQdWJsaXNoZXJcbiAgICAgICAgY29uc3QgY29udHJvbCA9IDxGaGlyQ29udHJvbD4ge1xuICAgICAgICAgICAgdG9vbDogJ2pla3lsbCcsXG4gICAgICAgICAgICBzb3VyY2U6ICdpbXBsZW1lbnRhdGlvbmd1aWRlLycgKyBpbXBsZW1lbnRhdGlvbkd1aWRlLmlkICsgJy54bWwnLFxuICAgICAgICAgICAgJ25wbS1uYW1lJzogcGFja2FnZUlkRXh0ZW5zaW9uICYmIHBhY2thZ2VJZEV4dGVuc2lvbi52YWx1ZVN0cmluZyA/IHBhY2thZ2VJZEV4dGVuc2lvbi52YWx1ZVN0cmluZyA6IGltcGxlbWVudGF0aW9uR3VpZGUuaWQgKyAnLW5wbScsXG4gICAgICAgICAgICBsaWNlbnNlOiAnQ0MwLTEuMCcsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUjQ6IEltcGxlbWVudGF0aW9uR3VpZGUubGljZW5zZVxuICAgICAgICAgICAgcGF0aHM6IHtcbiAgICAgICAgICAgICAgICBxYTogJ2dlbmVyYXRlZF9vdXRwdXQvcWEnLFxuICAgICAgICAgICAgICAgIHRlbXA6ICdnZW5lcmF0ZWRfb3V0cHV0L3RlbXAnLFxuICAgICAgICAgICAgICAgIG91dHB1dDogJ291dHB1dCcsXG4gICAgICAgICAgICAgICAgdHhDYWNoZTogJ2dlbmVyYXRlZF9vdXRwdXQvdHhDYWNoZScsXG4gICAgICAgICAgICAgICAgc3BlY2lmaWNhdGlvbjogJ2h0dHA6Ly9obDcub3JnL2ZoaXIvU1RVMycsXG4gICAgICAgICAgICAgICAgcGFnZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgJ2ZyYW1ld29yaycsXG4gICAgICAgICAgICAgICAgICAgICdzb3VyY2UvcGFnZXMnXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsgJ3NvdXJjZS9yZXNvdXJjZXMnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYWdlczogWydwYWdlcyddLFxuICAgICAgICAgICAgJ2V4dGVuc2lvbi1kb21haW5zJzogWydodHRwczovL3RyaWZvbGlhLW9uLWZoaXIubGFudGFuYWdyb3VwLmNvbSddLFxuICAgICAgICAgICAgJ2FsbG93ZWQtZG9tYWlucyc6IFsnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20nXSxcbiAgICAgICAgICAgICdzY3QtZWRpdGlvbic6ICdodHRwOi8vc25vbWVkLmluZm8vc2N0LzczMTAwMDEyNDEwOCcsXG4gICAgICAgICAgICBjYW5vbmljYWxCYXNlOiBjYW5vbmljYWxCYXNlLFxuICAgICAgICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgICAgICAgICAnTG9jYXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxuICAgICAgICAgICAgICAgICdQcm9jZWR1cmVSZXF1ZXN0Jzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnT3JnYW5pemF0aW9uJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnTWVkaWNhdGlvblN0YXRlbWVudCc6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ1NlYXJjaFBhcmFtZXRlcic6IHsndGVtcGxhdGUtYmFzZSc6ICdiYXNlLmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnU3RydWN0dXJlRGVmaW5pdGlvbic6IHtcbiAgICAgICAgICAgICAgICAgICAgJ3RlbXBsYXRlLW1hcHBpbmdzJzogJ3NkLW1hcHBpbmdzLmh0bWwnLFxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtYmFzZSc6ICdzZC5odG1sJyxcbiAgICAgICAgICAgICAgICAgICAgJ3RlbXBsYXRlLWRlZm5zJzogJ3NkLWRlZmluaXRpb25zLmh0bWwnXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAnSW1tdW5pemF0aW9uJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnUGF0aWVudCc6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ1N0cnVjdHVyZU1hcCc6IHtcbiAgICAgICAgICAgICAgICAgICAgJ2NvbnRlbnQnOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgJ3NjcmlwdCc6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJyxcbiAgICAgICAgICAgICAgICAgICAgJ3Byb2ZpbGVzJzogZmFsc2VcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICdDb25jZXB0TWFwJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxuICAgICAgICAgICAgICAgICdQcmFjdGl0aW9uZXInOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxuICAgICAgICAgICAgICAgICdPcGVyYXRpb25EZWZpbml0aW9uJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxuICAgICAgICAgICAgICAgICdDb2RlU3lzdGVtJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxuICAgICAgICAgICAgICAgICdDb21tdW5pY2F0aW9uJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnQW55Jzoge1xuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtZm9ybWF0JzogJ2Zvcm1hdC5odG1sJyxcbiAgICAgICAgICAgICAgICAgICAgJ3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgJ1ByYWN0aXRpb25lclJvbGUnOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxuICAgICAgICAgICAgICAgICdWYWx1ZVNldCc6IHsndGVtcGxhdGUtYmFzZSc6ICdiYXNlLmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnQ2FwYWJpbGl0eVN0YXRlbWVudCc6IHsndGVtcGxhdGUtYmFzZSc6ICdiYXNlLmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnT2JzZXJ2YXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVzb3VyY2VzOiB7fVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh2ZXJzaW9uKSB7XG4gICAgICAgICAgICBjb250cm9sLnZlcnNpb24gPSB2ZXJzaW9uO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHRoZSBkZXBlbmRlbmN5TGlzdCBiYXNlZCBvbiB0aGUgZXh0ZW5zaW9ucyBpbiB0aGUgSUdcbiAgICAgICAgY29uc3QgZGVwZW5kZW5jeUV4dGVuc2lvbnMgPSBfLmZpbHRlcihpbXBsZW1lbnRhdGlvbkd1aWRlLmV4dGVuc2lvbiwgKGV4dGVuc2lvbikgPT4gZXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3knKTtcblxuICAgICAgICAvLyBSNCBJbXBsZW1lbnRhdGlvbkd1aWRlLmRlcGVuZHNPblxuICAgICAgICBjb250cm9sLmRlcGVuZGVuY3lMaXN0ID0gXy5jaGFpbihkZXBlbmRlbmN5RXh0ZW5zaW9ucylcbiAgICAgICAgICAgIC5maWx0ZXIoKGRlcGVuZGVuY3lFeHRlbnNpb24pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsb2NhdGlvbkV4dGVuc2lvbiA9IF8uZmluZChkZXBlbmRlbmN5RXh0ZW5zaW9uLmV4dGVuc2lvbiwgKG5leHQpID0+IG5leHQudXJsID09PSAnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20vU3RydWN0dXJlRGVmaW5pdGlvbi9leHRlbnNpb24taWctZGVwZW5kZW5jeS1sb2NhdGlvbicpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG5hbWVFeHRlbnNpb24gPSBfLmZpbmQoZGVwZW5kZW5jeUV4dGVuc2lvbi5leHRlbnNpb24sIChuZXh0KSA9PiBuZXh0LnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3ktbmFtZScpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuICEhbG9jYXRpb25FeHRlbnNpb24gJiYgISFsb2NhdGlvbkV4dGVuc2lvbi52YWx1ZVN0cmluZyAmJiAhIW5hbWVFeHRlbnNpb24gJiYgISFuYW1lRXh0ZW5zaW9uLnZhbHVlU3RyaW5nO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5tYXAoKGRlcGVuZGVuY3lFeHRlbnNpb24pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsb2NhdGlvbkV4dGVuc2lvbiA9IDxFeHRlbnNpb24+IF8uZmluZChkZXBlbmRlbmN5RXh0ZW5zaW9uLmV4dGVuc2lvbiwgKG5leHQpID0+IG5leHQudXJsID09PSAnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20vU3RydWN0dXJlRGVmaW5pdGlvbi9leHRlbnNpb24taWctZGVwZW5kZW5jeS1sb2NhdGlvbicpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG5hbWVFeHRlbnNpb24gPSA8RXh0ZW5zaW9uPiBfLmZpbmQoZGVwZW5kZW5jeUV4dGVuc2lvbi5leHRlbnNpb24sIChuZXh0KSA9PiBuZXh0LnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3ktbmFtZScpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHZlcnNpb25FeHRlbnNpb24gPSA8RXh0ZW5zaW9uPiBfLmZpbmQoZGVwZW5kZW5jeUV4dGVuc2lvbi5leHRlbnNpb24sIChuZXh0KSA9PiBuZXh0LnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3ktdmVyc2lvbicpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIDxGaGlyQ29udHJvbERlcGVuZGVuY3k+IHtcbiAgICAgICAgICAgICAgICAgICAgbG9jYXRpb246IGxvY2F0aW9uRXh0ZW5zaW9uID8gbG9jYXRpb25FeHRlbnNpb24udmFsdWVVcmkgOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZUV4dGVuc2lvbiA/IG5hbWVFeHRlbnNpb24udmFsdWVTdHJpbmcgOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogdmVyc2lvbkV4dGVuc2lvbiA/IHZlcnNpb25FeHRlbnNpb24udmFsdWVTdHJpbmcgOiAnJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnZhbHVlKCk7XG5cbiAgICAgICAgLy8gRGVmaW5lIHRoZSByZXNvdXJjZXMgaW4gdGhlIGNvbnRyb2wgYW5kIHdoYXQgdGVtcGxhdGVzIHRoZXkgc2hvdWxkIHVzZVxuICAgICAgICBpZiAoYnVuZGxlICYmIGJ1bmRsZS5lbnRyeSkge1xuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBidW5kbGUuZW50cnkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICBjb25zdCBlbnRyeSA9IGJ1bmRsZS5lbnRyeVtpXTtcbiAgICAgICAgICAgICAgICBjb25zdCByZXNvdXJjZSA9IGVudHJ5LnJlc291cmNlO1xuXG4gICAgICAgICAgICAgICAgaWYgKHJlc291cmNlLnJlc291cmNlVHlwZSA9PT0gJ0ltcGxlbWVudGF0aW9uR3VpZGUnKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnRyb2wucmVzb3VyY2VzW3Jlc291cmNlLnJlc291cmNlVHlwZSArICcvJyArIHJlc291cmNlLmlkXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgYmFzZTogcmVzb3VyY2UucmVzb3VyY2VUeXBlICsgJy0nICsgcmVzb3VyY2UuaWQgKyAnLmh0bWwnLFxuICAgICAgICAgICAgICAgICAgICBkZWZuczogcmVzb3VyY2UucmVzb3VyY2VUeXBlICsgJy0nICsgcmVzb3VyY2UuaWQgKyAnLWRlZmluaXRpb25zLmh0bWwnXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjb250cm9sO1xuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIGdldFI0Q29udHJvbChpbXBsZW1lbnRhdGlvbkd1aWRlOiBSNEltcGxlbWVudGF0aW9uR3VpZGUsIGJ1bmRsZTogUjRCdW5kbGUsIHZlcnNpb246IHN0cmluZykge1xuICAgICAgICBjb25zdCBjYW5vbmljYWxCYXNlUmVnZXggPSAvXiguKz8pXFwvSW1wbGVtZW50YXRpb25HdWlkZVxcLy4rJC9nbTtcbiAgICAgICAgY29uc3QgY2Fub25pY2FsQmFzZU1hdGNoID0gY2Fub25pY2FsQmFzZVJlZ2V4LmV4ZWMoaW1wbGVtZW50YXRpb25HdWlkZS51cmwpO1xuICAgICAgICBsZXQgY2Fub25pY2FsQmFzZTtcblxuICAgICAgICBpZiAoIWNhbm9uaWNhbEJhc2VNYXRjaCB8fCBjYW5vbmljYWxCYXNlTWF0Y2gubGVuZ3RoIDwgMikge1xuICAgICAgICAgICAgY2Fub25pY2FsQmFzZSA9IGltcGxlbWVudGF0aW9uR3VpZGUudXJsLnN1YnN0cmluZygwLCBpbXBsZW1lbnRhdGlvbkd1aWRlLnVybC5sYXN0SW5kZXhPZignLycpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbm9uaWNhbEJhc2UgPSBjYW5vbmljYWxCYXNlTWF0Y2hbMV07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjdXJyZW50bHksIElHIHJlc291cmNlIGhhcyB0byBiZSBpbiBYTUwgZm9ybWF0IGZvciB0aGUgSUcgUHVibGlzaGVyXG4gICAgICAgIGNvbnN0IGNvbnRyb2wgPSA8RmhpckNvbnRyb2w+IHtcbiAgICAgICAgICAgIHRvb2w6ICdqZWt5bGwnLFxuICAgICAgICAgICAgc291cmNlOiAnaW1wbGVtZW50YXRpb25ndWlkZS8nICsgaW1wbGVtZW50YXRpb25HdWlkZS5pZCArICcueG1sJyxcbiAgICAgICAgICAgICducG0tbmFtZSc6IGltcGxlbWVudGF0aW9uR3VpZGUucGFja2FnZUlkIHx8IGltcGxlbWVudGF0aW9uR3VpZGUuaWQgKyAnLW5wbScsXG4gICAgICAgICAgICBsaWNlbnNlOiBpbXBsZW1lbnRhdGlvbkd1aWRlLmxpY2Vuc2UgfHwgJ0NDMC0xLjAnLFxuICAgICAgICAgICAgcGF0aHM6IHtcbiAgICAgICAgICAgICAgICBxYTogJ2dlbmVyYXRlZF9vdXRwdXQvcWEnLFxuICAgICAgICAgICAgICAgIHRlbXA6ICdnZW5lcmF0ZWRfb3V0cHV0L3RlbXAnLFxuICAgICAgICAgICAgICAgIG91dHB1dDogJ291dHB1dCcsXG4gICAgICAgICAgICAgICAgdHhDYWNoZTogJ2dlbmVyYXRlZF9vdXRwdXQvdHhDYWNoZScsXG4gICAgICAgICAgICAgICAgc3BlY2lmaWNhdGlvbjogJ2h0dHA6Ly9obDcub3JnL2ZoaXIvUjQvJyxcbiAgICAgICAgICAgICAgICBwYWdlczogW1xuICAgICAgICAgICAgICAgICAgICAnZnJhbWV3b3JrJyxcbiAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZS9wYWdlcydcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWyAnc291cmNlL3Jlc291cmNlcycgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHBhZ2VzOiBbJ3BhZ2VzJ10sXG4gICAgICAgICAgICAnZXh0ZW5zaW9uLWRvbWFpbnMnOiBbJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tJ10sXG4gICAgICAgICAgICAnYWxsb3dlZC1kb21haW5zJzogWydodHRwczovL3RyaWZvbGlhLW9uLWZoaXIubGFudGFuYWdyb3VwLmNvbSddLFxuICAgICAgICAgICAgJ3NjdC1lZGl0aW9uJzogJ2h0dHA6Ly9zbm9tZWQuaW5mby9zY3QvNzMxMDAwMTI0MTA4JyxcbiAgICAgICAgICAgIGNhbm9uaWNhbEJhc2U6IGNhbm9uaWNhbEJhc2UsXG4gICAgICAgICAgICBkZWZhdWx0czoge1xuICAgICAgICAgICAgICAgICdMb2NhdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ1Byb2NlZHVyZVJlcXVlc3QnOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxuICAgICAgICAgICAgICAgICdPcmdhbml6YXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxuICAgICAgICAgICAgICAgICdNZWRpY2F0aW9uU3RhdGVtZW50Jzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnU2VhcmNoUGFyYW1ldGVyJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxuICAgICAgICAgICAgICAgICdTdHJ1Y3R1cmVEZWZpbml0aW9uJzoge1xuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtbWFwcGluZ3MnOiAnc2QtbWFwcGluZ3MuaHRtbCcsXG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1iYXNlJzogJ3NkLmh0bWwnLFxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtZGVmbnMnOiAnc2QtZGVmaW5pdGlvbnMuaHRtbCdcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICdJbW11bml6YXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxuICAgICAgICAgICAgICAgICdQYXRpZW50Jzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcbiAgICAgICAgICAgICAgICAnU3RydWN0dXJlTWFwJzoge1xuICAgICAgICAgICAgICAgICAgICAnY29udGVudCc6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAnc2NyaXB0JzogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnLFxuICAgICAgICAgICAgICAgICAgICAncHJvZmlsZXMnOiBmYWxzZVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgJ0NvbmNlcHRNYXAnOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ1ByYWN0aXRpb25lcic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ09wZXJhdGlvbkRlZmluaXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ0NvZGVTeXN0ZW0nOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ0NvbW11bmljYXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxuICAgICAgICAgICAgICAgICdBbnknOiB7XG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1mb3JtYXQnOiAnZm9ybWF0Lmh0bWwnLFxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtYmFzZSc6ICdiYXNlLmh0bWwnXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAnUHJhY3RpdGlvbmVyUm9sZSc6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXG4gICAgICAgICAgICAgICAgJ1ZhbHVlU2V0Jzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxuICAgICAgICAgICAgICAgICdDYXBhYmlsaXR5U3RhdGVtZW50Jzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxuICAgICAgICAgICAgICAgICdPYnNlcnZhdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ31cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IHt9XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKHZlcnNpb24pIHtcbiAgICAgICAgICAgIGNvbnRyb2wudmVyc2lvbiA9IHZlcnNpb247XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaW1wbGVtZW50YXRpb25HdWlkZS5maGlyVmVyc2lvbiAmJiBpbXBsZW1lbnRhdGlvbkd1aWRlLmZoaXJWZXJzaW9uLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnRyb2xbJ2ZpeGVkLWJ1c2luZXNzLXZlcnNpb24nXSA9IGltcGxlbWVudGF0aW9uR3VpZGUuZmhpclZlcnNpb25bMF07XG4gICAgICAgIH1cblxuICAgICAgICBjb250cm9sLmRlcGVuZGVuY3lMaXN0ID0gXy5jaGFpbihpbXBsZW1lbnRhdGlvbkd1aWRlLmRlcGVuZHNPbilcbiAgICAgICAgICAgIC5maWx0ZXIoKGRlcGVuZHNPbikgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvY2F0aW9uRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZHNPbi5leHRlbnNpb24sIChkZXBlbmRlbmN5RXh0ZW5zaW9uKSA9PiBkZXBlbmRlbmN5RXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtZmhpci5sYW50YW5hZ3JvdXAuY29tL3I0L1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZHMtb24tbG9jYXRpb24nKTtcbiAgICAgICAgICAgICAgICBjb25zdCBuYW1lRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZHNPbi5leHRlbnNpb24sIChkZXBlbmRlbmN5RXh0ZW5zaW9uKSA9PiBkZXBlbmRlbmN5RXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtZmhpci5sYW50YW5hZ3JvdXAuY29tL3I0L1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZHMtb24tbmFtZScpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuICEhbG9jYXRpb25FeHRlbnNpb24gJiYgISFsb2NhdGlvbkV4dGVuc2lvbi52YWx1ZVN0cmluZyAmJiAhIW5hbWVFeHRlbnNpb24gJiYgISFuYW1lRXh0ZW5zaW9uLnZhbHVlU3RyaW5nO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5tYXAoKGRlcGVuZHNPbikgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvY2F0aW9uRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZHNPbi5leHRlbnNpb24sIChkZXBlbmRlbmN5RXh0ZW5zaW9uKSA9PiBkZXBlbmRlbmN5RXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtZmhpci5sYW50YW5hZ3JvdXAuY29tL3I0L1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZHMtb24tbG9jYXRpb24nKTtcbiAgICAgICAgICAgICAgICBjb25zdCBuYW1lRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZHNPbi5leHRlbnNpb24sIChkZXBlbmRlbmN5RXh0ZW5zaW9uKSA9PiBkZXBlbmRlbmN5RXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtZmhpci5sYW50YW5hZ3JvdXAuY29tL3I0L1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZHMtb24tbmFtZScpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgbG9jYXRpb246IGxvY2F0aW9uRXh0ZW5zaW9uID8gbG9jYXRpb25FeHRlbnNpb24udmFsdWVTdHJpbmcgOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZUV4dGVuc2lvbiA/IG5hbWVFeHRlbnNpb24udmFsdWVTdHJpbmcgOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogZGVwZW5kc09uLnZlcnNpb25cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC52YWx1ZSgpO1xuXG4gICAgICAgIC8vIERlZmluZSB0aGUgcmVzb3VyY2VzIGluIHRoZSBjb250cm9sIGFuZCB3aGF0IHRlbXBsYXRlcyB0aGV5IHNob3VsZCB1c2VcbiAgICAgICAgaWYgKGJ1bmRsZSAmJiBidW5kbGUuZW50cnkpIHtcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYnVuZGxlLmVudHJ5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZW50cnkgPSBidW5kbGUuZW50cnlbaV07XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzb3VyY2UgPSBlbnRyeS5yZXNvdXJjZTtcblxuICAgICAgICAgICAgICAgIGlmIChyZXNvdXJjZS5yZXNvdXJjZVR5cGUgPT09ICdJbXBsZW1lbnRhdGlvbkd1aWRlJykge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb250cm9sLnJlc291cmNlc1tyZXNvdXJjZS5yZXNvdXJjZVR5cGUgKyAnLycgKyByZXNvdXJjZS5pZF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGJhc2U6IHJlc291cmNlLnJlc291cmNlVHlwZSArICctJyArIHJlc291cmNlLmlkICsgJy5odG1sJyxcbiAgICAgICAgICAgICAgICAgICAgZGVmbnM6IHJlc291cmNlLnJlc291cmNlVHlwZSArICctJyArIHJlc291cmNlLmlkICsgJy1kZWZpbml0aW9ucy5odG1sJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY29udHJvbDtcbiAgICB9XG4gICAgXG4gICAgcHJpdmF0ZSBnZXRTdHUzUGFnZUNvbnRlbnQoaW1wbGVtZW50YXRpb25HdWlkZTogU1RVM0ltcGxlbWVudGF0aW9uR3VpZGUsIHBhZ2U6IFBhZ2VDb21wb25lbnQpIHtcbiAgICAgICAgY29uc3QgY29udGVudEV4dGVuc2lvbiA9IF8uZmluZChwYWdlLmV4dGVuc2lvbiwgKGV4dGVuc2lvbikgPT4gZXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLXBhZ2UtY29udGVudCcpO1xuXG4gICAgICAgIGlmIChjb250ZW50RXh0ZW5zaW9uICYmIGNvbnRlbnRFeHRlbnNpb24udmFsdWVSZWZlcmVuY2UgJiYgY29udGVudEV4dGVuc2lvbi52YWx1ZVJlZmVyZW5jZS5yZWZlcmVuY2UgJiYgcGFnZS5zb3VyY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlZmVyZW5jZSA9IGNvbnRlbnRFeHRlbnNpb24udmFsdWVSZWZlcmVuY2UucmVmZXJlbmNlO1xuXG4gICAgICAgICAgICBpZiAocmVmZXJlbmNlLnN0YXJ0c1dpdGgoJyMnKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5lZCA9IF8uZmluZChpbXBsZW1lbnRhdGlvbkd1aWRlLmNvbnRhaW5lZCwgKGNvbnRhaW5lZCkgPT4gY29udGFpbmVkLmlkID09PSByZWZlcmVuY2Uuc3Vic3RyaW5nKDEpKTtcbiAgICAgICAgICAgICAgICBjb25zdCBiaW5hcnkgPSBjb250YWluZWQgJiYgY29udGFpbmVkLnJlc291cmNlVHlwZSA9PT0gJ0JpbmFyeScgPyA8U1RVM0JpbmFyeT4gY29udGFpbmVkIDogdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAgICAgaWYgKGJpbmFyeSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IHBhZ2Uuc291cmNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogQnVmZmVyLmZyb20oYmluYXJ5LmNvbnRlbnQsICdiYXNlNjQnKS50b1N0cmluZygpXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHByaXZhdGUgd3JpdGVTdHUzUGFnZShwYWdlc1BhdGg6IHN0cmluZywgaW1wbGVtZW50YXRpb25HdWlkZTogU1RVM0ltcGxlbWVudGF0aW9uR3VpZGUsIHBhZ2U6IFBhZ2VDb21wb25lbnQsIGxldmVsOiBudW1iZXIsIHRvY0VudHJpZXM6IFRhYmxlT2ZDb250ZW50c0VudHJ5W10pIHtcbiAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSB0aGlzLmdldFN0dTNQYWdlQ29udGVudChpbXBsZW1lbnRhdGlvbkd1aWRlLCBwYWdlKTtcblxuICAgICAgICBpZiAocGFnZS5raW5kICE9PSAndG9jJyAmJiBwYWdlQ29udGVudCAmJiBwYWdlQ29udGVudC5jb250ZW50KSB7XG4gICAgICAgICAgICBjb25zdCBuZXdQYWdlUGF0aCA9IHBhdGguam9pbihwYWdlc1BhdGgsIHBhZ2VDb250ZW50LmZpbGVOYW1lKTtcblxuICAgICAgICAgICAgY29uc3QgY29udGVudCA9ICctLS1cXG4nICtcbiAgICAgICAgICAgICAgICBgdGl0bGU6ICR7cGFnZS50aXRsZX1cXG5gICtcbiAgICAgICAgICAgICAgICAnbGF5b3V0OiBkZWZhdWx0XFxuJyArXG4gICAgICAgICAgICAgICAgYGFjdGl2ZTogJHtwYWdlLnRpdGxlfVxcbmAgK1xuICAgICAgICAgICAgICAgICctLS1cXG5cXG4nICsgcGFnZUNvbnRlbnQuY29udGVudDtcblxuICAgICAgICAgICAgZnMud3JpdGVGaWxlU3luYyhuZXdQYWdlUGF0aCwgY29udGVudCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgYW4gZW50cnkgdG8gdGhlIFRPQ1xuICAgICAgICB0b2NFbnRyaWVzLnB1c2goeyBsZXZlbDogbGV2ZWwsIGZpbGVOYW1lOiBwYWdlLmtpbmQgPT09ICdwYWdlJyAmJiBwYWdlQ29udGVudCA/IHBhZ2VDb250ZW50LmZpbGVOYW1lIDogbnVsbCwgdGl0bGU6IHBhZ2UudGl0bGUgfSk7XG4gICAgICAgIF8uZWFjaChwYWdlLnBhZ2UsIChzdWJQYWdlKSA9PiB0aGlzLndyaXRlU3R1M1BhZ2UocGFnZXNQYXRoLCBpbXBsZW1lbnRhdGlvbkd1aWRlLCBzdWJQYWdlLCBsZXZlbCArIDEsIHRvY0VudHJpZXMpKTtcbiAgICB9XG4gICAgXG4gICAgcHJpdmF0ZSBnZXRQYWdlRXh0ZW5zaW9uKHBhZ2U6IEltcGxlbWVudGF0aW9uR3VpZGVQYWdlQ29tcG9uZW50KSB7XG4gICAgICAgIHN3aXRjaCAocGFnZS5nZW5lcmF0aW9uKSB7XG4gICAgICAgICAgICBjYXNlICdodG1sJzpcbiAgICAgICAgICAgIGNhc2UgJ2dlbmVyYXRlZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuICcuaHRtbCc7XG4gICAgICAgICAgICBjYXNlICd4bWwnOlxuICAgICAgICAgICAgICAgIHJldHVybiAnLnhtbCc7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiAnLm1kJztcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIHdyaXRlUjRQYWdlKHBhZ2VzUGF0aDogc3RyaW5nLCBpbXBsZW1lbnRhdGlvbkd1aWRlOiBSNEltcGxlbWVudGF0aW9uR3VpZGUsIHBhZ2U6IEltcGxlbWVudGF0aW9uR3VpZGVQYWdlQ29tcG9uZW50LCBsZXZlbDogbnVtYmVyLCB0b2NFbnRyaWVzOiBUYWJsZU9mQ29udGVudHNFbnRyeVtdKSB7XG4gICAgICAgIGxldCBmaWxlTmFtZTtcblxuICAgICAgICBpZiAocGFnZS5uYW1lUmVmZXJlbmNlICYmIHBhZ2UubmFtZVJlZmVyZW5jZS5yZWZlcmVuY2UgJiYgcGFnZS50aXRsZSkge1xuICAgICAgICAgICAgY29uc3QgcmVmZXJlbmNlID0gcGFnZS5uYW1lUmVmZXJlbmNlLnJlZmVyZW5jZTtcblxuICAgICAgICAgICAgaWYgKHJlZmVyZW5jZS5zdGFydHNXaXRoKCcjJykpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjb250YWluZWQgPSBfLmZpbmQoaW1wbGVtZW50YXRpb25HdWlkZS5jb250YWluZWQsIChjb250YWluZWQpID0+IGNvbnRhaW5lZC5pZCA9PT0gcmVmZXJlbmNlLnN1YnN0cmluZygxKSk7XG4gICAgICAgICAgICAgICAgY29uc3QgYmluYXJ5ID0gY29udGFpbmVkICYmIGNvbnRhaW5lZC5yZXNvdXJjZVR5cGUgPT09ICdCaW5hcnknID8gPFI0QmluYXJ5PiBjb250YWluZWQgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgICAgICBpZiAoYmluYXJ5ICYmIGJpbmFyeS5kYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lID0gcGFnZS50aXRsZS5yZXBsYWNlKC8gL2csICdfJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJy4nKSA8IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lICs9IHRoaXMuZ2V0UGFnZUV4dGVuc2lvbihwYWdlKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld1BhZ2VQYXRoID0gcGF0aC5qb2luKHBhZ2VzUGF0aCwgZmlsZU5hbWUpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIG5vaW5zcGVjdGlvbiBKU1VucmVzb2x2ZWRGdW5jdGlvblxuICAgICAgICAgICAgICAgICAgICBjb25zdCBiaW5hcnlDb250ZW50ID0gQnVmZmVyLmZyb20oYmluYXJ5LmRhdGEsICdiYXNlNjQnKS50b1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250ZW50ID0gJy0tLVxcbicgK1xuICAgICAgICAgICAgICAgICAgICAgICAgYHRpdGxlOiAke3BhZ2UudGl0bGV9XFxuYCArXG4gICAgICAgICAgICAgICAgICAgICAgICAnbGF5b3V0OiBkZWZhdWx0XFxuJyArXG4gICAgICAgICAgICAgICAgICAgICAgICBgYWN0aXZlOiAke3BhZ2UudGl0bGV9XFxuYCArXG4gICAgICAgICAgICAgICAgICAgICAgICBgLS0tXFxuXFxuJHtiaW5hcnlDb250ZW50fWA7XG4gICAgICAgICAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMobmV3UGFnZVBhdGgsIGNvbnRlbnQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBhbiBlbnRyeSB0byB0aGUgVE9DXG4gICAgICAgIHRvY0VudHJpZXMucHVzaCh7IGxldmVsOiBsZXZlbCwgZmlsZU5hbWU6IGZpbGVOYW1lLCB0aXRsZTogcGFnZS50aXRsZSB9KTtcblxuICAgICAgICBfLmVhY2gocGFnZS5wYWdlLCAoc3ViUGFnZSkgPT4gdGhpcy53cml0ZVI0UGFnZShwYWdlc1BhdGgsIGltcGxlbWVudGF0aW9uR3VpZGUsIHN1YlBhZ2UsIGxldmVsICsgMSwgdG9jRW50cmllcykpO1xuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIGdlbmVyYXRlVGFibGVPZkNvbnRlbnRzKHJvb3RQYXRoOiBzdHJpbmcsIHRvY0VudHJpZXM6IFRhYmxlT2ZDb250ZW50c0VudHJ5W10sIHNob3VsZEF1dG9HZW5lcmF0ZTogYm9vbGVhbiwgcGFnZUNvbnRlbnQpIHtcbiAgICAgICAgY29uc3QgdG9jUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgJ3NvdXJjZS9wYWdlcy90b2MubWQnKTtcbiAgICAgICAgbGV0IHRvY0NvbnRlbnQgPSAnJztcblxuICAgICAgICBpZiAoc2hvdWxkQXV0b0dlbmVyYXRlKSB7XG4gICAgICAgICAgICBfLmVhY2godG9jRW50cmllcywgKGVudHJ5KSA9PiB7XG4gICAgICAgICAgICAgICAgbGV0IGZpbGVOYW1lID0gZW50cnkuZmlsZU5hbWU7XG5cbiAgICAgICAgICAgICAgICBpZiAoZmlsZU5hbWUgJiYgZmlsZU5hbWUuZW5kc1dpdGgoJy5tZCcpKSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lID0gZmlsZU5hbWUuc3Vic3RyaW5nKDAsIGZpbGVOYW1lLmxlbmd0aCAtIDMpICsgJy5odG1sJztcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGVudHJ5LmxldmVsOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdG9jQ29udGVudCArPSAnICAgICc7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdG9jQ29udGVudCArPSAnKiAnO1xuXG4gICAgICAgICAgICAgICAgaWYgKGZpbGVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRvY0NvbnRlbnQgKz0gYDxhIGhyZWY9XCIke2ZpbGVOYW1lfVwiPiR7ZW50cnkudGl0bGV9PC9hPlxcbmA7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdG9jQ29udGVudCArPSBgJHtlbnRyeS50aXRsZX1cXG5gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKHBhZ2VDb250ZW50ICYmIHBhZ2VDb250ZW50LmNvbnRlbnQpIHtcbiAgICAgICAgICAgIHRvY0NvbnRlbnQgPSBwYWdlQ29udGVudC5jb250ZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRvY0NvbnRlbnQpIHtcbiAgICAgICAgICAgIGZzLmFwcGVuZEZpbGVTeW5jKHRvY1BhdGgsIHRvY0NvbnRlbnQpO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHByaXZhdGUgd3JpdGVTdHUzUGFnZXMocm9vdFBhdGg6IHN0cmluZywgaW1wbGVtZW50YXRpb25HdWlkZTogU1RVM0ltcGxlbWVudGF0aW9uR3VpZGUpIHtcbiAgICAgICAgY29uc3QgdG9jRmlsZVBhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsICdzb3VyY2UvcGFnZXMvdG9jLm1kJyk7XG4gICAgICAgIGNvbnN0IHRvY0VudHJpZXMgPSBbXTtcblxuICAgICAgICBpZiAoaW1wbGVtZW50YXRpb25HdWlkZS5wYWdlKSB7XG4gICAgICAgICAgICBjb25zdCBhdXRvR2VuZXJhdGVFeHRlbnNpb24gPSBfLmZpbmQoaW1wbGVtZW50YXRpb25HdWlkZS5wYWdlLmV4dGVuc2lvbiwgKGV4dGVuc2lvbikgPT4gZXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLXBhZ2UtYXV0by1nZW5lcmF0ZS10b2MnKTtcbiAgICAgICAgICAgIGNvbnN0IHNob3VsZEF1dG9HZW5lcmF0ZSA9IGF1dG9HZW5lcmF0ZUV4dGVuc2lvbiAmJiBhdXRvR2VuZXJhdGVFeHRlbnNpb24udmFsdWVCb29sZWFuID09PSB0cnVlO1xuICAgICAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSB0aGlzLmdldFN0dTNQYWdlQ29udGVudChpbXBsZW1lbnRhdGlvbkd1aWRlLCBpbXBsZW1lbnRhdGlvbkd1aWRlLnBhZ2UpO1xuICAgICAgICAgICAgY29uc3QgcGFnZXNQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzJyk7XG4gICAgICAgICAgICBmcy5lbnN1cmVEaXJTeW5jKHBhZ2VzUGF0aCk7XG5cbiAgICAgICAgICAgIHRoaXMud3JpdGVTdHUzUGFnZShwYWdlc1BhdGgsIGltcGxlbWVudGF0aW9uR3VpZGUsIGltcGxlbWVudGF0aW9uR3VpZGUucGFnZSwgMSwgdG9jRW50cmllcyk7XG4gICAgICAgICAgICB0aGlzLmdlbmVyYXRlVGFibGVPZkNvbnRlbnRzKHJvb3RQYXRoLCB0b2NFbnRyaWVzLCBzaG91bGRBdXRvR2VuZXJhdGUsIHBhZ2VDb250ZW50KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIHdyaXRlUjRQYWdlcyhyb290UGF0aDogc3RyaW5nLCBpbXBsZW1lbnRhdGlvbkd1aWRlOiBSNEltcGxlbWVudGF0aW9uR3VpZGUpIHtcbiAgICAgICAgY29uc3QgdG9jRW50cmllcyA9IFtdO1xuICAgICAgICBsZXQgc2hvdWxkQXV0b0dlbmVyYXRlID0gdHJ1ZTtcbiAgICAgICAgbGV0IHJvb3RQYWdlQ29udGVudDtcbiAgICAgICAgbGV0IHJvb3RQYWdlRmlsZU5hbWU7XG5cbiAgICAgICAgaWYgKGltcGxlbWVudGF0aW9uR3VpZGUuZGVmaW5pdGlvbiAmJiBpbXBsZW1lbnRhdGlvbkd1aWRlLmRlZmluaXRpb24ucGFnZSkge1xuICAgICAgICAgICAgY29uc3QgYXV0b0dlbmVyYXRlRXh0ZW5zaW9uID0gXy5maW5kKGltcGxlbWVudGF0aW9uR3VpZGUuZGVmaW5pdGlvbi5wYWdlLmV4dGVuc2lvbiwgKGV4dGVuc2lvbikgPT4gZXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLXBhZ2UtYXV0by1nZW5lcmF0ZS10b2MnKTtcbiAgICAgICAgICAgIHNob3VsZEF1dG9HZW5lcmF0ZSA9IGF1dG9HZW5lcmF0ZUV4dGVuc2lvbiAmJiBhdXRvR2VuZXJhdGVFeHRlbnNpb24udmFsdWVCb29sZWFuID09PSB0cnVlO1xuICAgICAgICAgICAgY29uc3QgcGFnZXNQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzJyk7XG4gICAgICAgICAgICBmcy5lbnN1cmVEaXJTeW5jKHBhZ2VzUGF0aCk7XG5cbiAgICAgICAgICAgIGlmIChpbXBsZW1lbnRhdGlvbkd1aWRlLmRlZmluaXRpb24ucGFnZS5uYW1lUmVmZXJlbmNlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmFtZVJlZmVyZW5jZSA9IGltcGxlbWVudGF0aW9uR3VpZGUuZGVmaW5pdGlvbi5wYWdlLm5hbWVSZWZlcmVuY2U7XG5cbiAgICAgICAgICAgICAgICBpZiAobmFtZVJlZmVyZW5jZS5yZWZlcmVuY2UgJiYgbmFtZVJlZmVyZW5jZS5yZWZlcmVuY2Uuc3RhcnRzV2l0aCgnIycpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvdW5kQ29udGFpbmVkID0gXy5maW5kKGltcGxlbWVudGF0aW9uR3VpZGUuY29udGFpbmVkLCAoY29udGFpbmVkKSA9PiBjb250YWluZWQuaWQgPT09IG5hbWVSZWZlcmVuY2UucmVmZXJlbmNlLnN1YnN0cmluZygxKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpbmFyeSA9IGZvdW5kQ29udGFpbmVkICYmIGZvdW5kQ29udGFpbmVkLnJlc291cmNlVHlwZSA9PT0gJ0JpbmFyeScgPyA8UjRCaW5hcnk+IGZvdW5kQ29udGFpbmVkIDogdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChiaW5hcnkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvb3RQYWdlQ29udGVudCA9IG5ldyBCdWZmZXIoYmluYXJ5LmRhdGEsICdiYXNlNjQnKS50b1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vdFBhZ2VGaWxlTmFtZSA9IGltcGxlbWVudGF0aW9uR3VpZGUuZGVmaW5pdGlvbi5wYWdlLnRpdGxlLnJlcGxhY2UoLyAvZywgJ18nKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyb290UGFnZUZpbGVOYW1lLmVuZHNXaXRoKCcubWQnKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvb3RQYWdlRmlsZU5hbWUgKz0gJy5tZCc7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMud3JpdGVSNFBhZ2UocGFnZXNQYXRoLCBpbXBsZW1lbnRhdGlvbkd1aWRlLCBpbXBsZW1lbnRhdGlvbkd1aWRlLmRlZmluaXRpb24ucGFnZSwgMSwgdG9jRW50cmllcyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBlbmQgVE9DIEVudHJpZXMgdG8gdGhlIHRvYy5tZCBmaWxlIGluIHRoZSB0ZW1wbGF0ZVxuICAgICAgICB0aGlzLmdlbmVyYXRlVGFibGVPZkNvbnRlbnRzKHJvb3RQYXRoLCB0b2NFbnRyaWVzLCBzaG91bGRBdXRvR2VuZXJhdGUsIHsgZmlsZU5hbWU6IHJvb3RQYWdlRmlsZU5hbWUsIGNvbnRlbnQ6IHJvb3RQYWdlQ29udGVudCB9KTtcbiAgICB9XG4gICAgXG4gICAgcHVibGljIGV4cG9ydChmb3JtYXQ6IHN0cmluZywgZXhlY3V0ZUlnUHVibGlzaGVyOiBib29sZWFuLCB1c2VUZXJtaW5vbG9neVNlcnZlcjogYm9vbGVhbiwgdXNlTGF0ZXN0OiBib29sZWFuLCBkb3dubG9hZE91dHB1dDogYm9vbGVhbiwgaW5jbHVkZUlnUHVibGlzaGVySmFyOiBib29sZWFuLCB0ZXN0Q2FsbGJhY2s/OiAobWVzc2FnZSwgZXJyPykgPT4gdm9pZCkge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYnVuZGxlRXhwb3J0ZXIgPSBuZXcgQnVuZGxlRXhwb3J0ZXIodGhpcy5maGlyU2VydmVyQmFzZSwgdGhpcy5maGlyU2VydmVySWQsIHRoaXMuZmhpclZlcnNpb24sIHRoaXMuZmhpciwgdGhpcy5pbXBsZW1lbnRhdGlvbkd1aWRlSWQpO1xuICAgICAgICAgICAgY29uc3QgaXNYbWwgPSBmb3JtYXQgPT09ICd4bWwnIHx8IGZvcm1hdCA9PT0gJ2FwcGxpY2F0aW9uL3htbCcgfHwgZm9ybWF0ID09PSAnYXBwbGljYXRpb24vZmhpcit4bWwnO1xuICAgICAgICAgICAgY29uc3QgZXh0ZW5zaW9uID0gKCFpc1htbCA/ICcuanNvbicgOiAnLnhtbCcpO1xuICAgICAgICAgICAgY29uc3QgaG9tZWRpciA9IHJlcXVpcmUoJ29zJykuaG9tZWRpcigpO1xuICAgICAgICAgICAgY29uc3QgZmhpclNlcnZlckNvbmZpZyA9IF8uZmluZChmaGlyQ29uZmlnLnNlcnZlcnMsIChzZXJ2ZXI6IEZoaXJDb25maWdTZXJ2ZXIpID0+IHNlcnZlci5pZCA9PT0gdGhpcy5maGlyU2VydmVySWQpO1xuICAgICAgICAgICAgbGV0IGNvbnRyb2w7XG4gICAgICAgICAgICBsZXQgaW1wbGVtZW50YXRpb25HdWlkZVJlc291cmNlO1xuXG4gICAgICAgICAgICB0bXAuZGlyKCh0bXBEaXJFcnIsIHJvb3RQYXRoKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHRtcERpckVycikge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcih0bXBEaXJFcnIpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KCdBbiBlcnJvciBvY2N1cnJlZCB3aGlsZSBjcmVhdGluZyBhIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICcgKyB0bXBEaXJFcnIpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnaWcuanNvbicpO1xuICAgICAgICAgICAgICAgIGxldCBidW5kbGU6IEJ1bmRsZTtcblxuICAgICAgICAgICAgICAgIHRoaXMucGFja2FnZUlkID0gcm9vdFBhdGguc3Vic3RyaW5nKHJvb3RQYXRoLmxhc3RJbmRleE9mKHBhdGguc2VwKSArIDEpO1xuICAgICAgICAgICAgICAgIHJlc29sdmUodGhpcy5wYWNrYWdlSWQpO1xuXG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ0NyZWF0ZWQgdGVtcCBkaXJlY3RvcnkuIFJldHJpZXZpbmcgcmVzb3VyY2VzIGZvciBpbXBsZW1lbnRhdGlvbiBndWlkZS4nKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBQcmVwYXJlIElHIFB1Ymxpc2hlciBwYWNrYWdlXG4gICAgICAgICAgICAgICAgICAgIGJ1bmRsZUV4cG9ydGVyLmdldEJ1bmRsZShmYWxzZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC50aGVuKChyZXN1bHRzOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBidW5kbGUgPSA8QnVuZGxlPiByZXN1bHRzO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc291cmNlc0RpciA9IHBhdGguam9pbihyb290UGF0aCwgJ3NvdXJjZS9yZXNvdXJjZXMnKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ1Jlc291cmNlcyByZXRyaWV2ZWQuIFBhY2thZ2luZy4nKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYnVuZGxlLmVudHJ5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc291cmNlID0gYnVuZGxlLmVudHJ5W2ldLnJlc291cmNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleHRlbnNpb25sZXNzUmVzb3VyY2UgPSBCdW5kbGVFeHBvcnRlci5yZW1vdmVFeHRlbnNpb25zKHJlc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gcmVzb3VyY2UucmVzb3VyY2VUeXBlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZCA9IHJlc291cmNlLmlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXNvdXJjZURpciA9IHBhdGguam9pbihyZXNvdXJjZXNEaXIsIHJlc291cmNlVHlwZS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGV0IHJlc291cmNlUGF0aDtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVzb3VyY2VDb250ZW50ID0gbnVsbDtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVzb3VyY2VUeXBlID09PSAnSW1wbGVtZW50YXRpb25HdWlkZScgJiYgaWQgPT09IHRoaXMuaW1wbGVtZW50YXRpb25HdWlkZUlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbXBsZW1lbnRhdGlvbkd1aWRlUmVzb3VyY2UgPSByZXNvdXJjZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEltcGxlbWVudGF0aW9uR3VpZGUgbXVzdCBiZSBnZW5lcmF0ZWQgYXMgYW4geG1sIGZpbGUgZm9yIHRoZSBJRyBQdWJsaXNoZXIgaW4gU1RVMy5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFpc1htbCAmJiByZXNvdXJjZVR5cGUgIT09ICdJbXBsZW1lbnRhdGlvbkd1aWRlJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VDb250ZW50ID0gSlNPTi5zdHJpbmdpZnkoZXh0ZW5zaW9ubGVzc1Jlc291cmNlLCBudWxsLCAnXFx0Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZVBhdGggPSBwYXRoLmpvaW4ocmVzb3VyY2VEaXIsIGlkICsgJy5qc29uJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZUNvbnRlbnQgPSB0aGlzLmZoaXIub2JqVG9YbWwoZXh0ZW5zaW9ubGVzc1Jlc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlQ29udGVudCA9IHZrYmVhdXRpZnkueG1sKHJlc291cmNlQ29udGVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZVBhdGggPSBwYXRoLmpvaW4ocmVzb3VyY2VEaXIsIGlkICsgJy54bWwnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmVuc3VyZURpclN5bmMocmVzb3VyY2VEaXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHJlc291cmNlUGF0aCwgcmVzb3VyY2VDb250ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWltcGxlbWVudGF0aW9uR3VpZGVSZXNvdXJjZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSBpbXBsZW1lbnRhdGlvbiBndWlkZSB3YXMgbm90IGZvdW5kIGluIHRoZSBidW5kbGUgcmV0dXJuZWQgYnkgdGhlIHNlcnZlcicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmaGlyU2VydmVyQ29uZmlnLnZlcnNpb24gPT09ICdzdHUzJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sID0gdGhpcy5nZXRTdHUzQ29udHJvbChpbXBsZW1lbnRhdGlvbkd1aWRlUmVzb3VyY2UsIDxTVFUzQnVuZGxlPjxhbnk+IGJ1bmRsZSwgdGhpcy5nZXRGaGlyQ29udHJvbFZlcnNpb24oZmhpclNlcnZlckNvbmZpZykpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2wgPSB0aGlzLmdldFI0Q29udHJvbChpbXBsZW1lbnRhdGlvbkd1aWRlUmVzb3VyY2UsIDxSNEJ1bmRsZT48YW55PiBidW5kbGUsIHRoaXMuZ2V0RmhpckNvbnRyb2xWZXJzaW9uKGZoaXJTZXJ2ZXJDb25maWcpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5nZXREZXBlbmRlbmNpZXMoY29udHJvbCwgaXNYbWwsIHJlc291cmNlc0RpciwgdGhpcy5maGlyLCBmaGlyU2VydmVyQ29uZmlnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ29weSB0aGUgY29udGVudHMgb2YgdGhlIGlnLXB1Ymxpc2hlci10ZW1wbGF0ZSBmb2xkZXIgdG8gdGhlIGV4cG9ydCB0ZW1wb3JhcnkgZm9sZGVyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGVQYXRoID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uLycsICdpZy1wdWJsaXNoZXItdGVtcGxhdGUnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy5jb3B5U3luYyh0ZW1wbGF0ZVBhdGgsIHJvb3RQYXRoKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXRlIHRoZSBpZy5qc29uIGZpbGUgdG8gdGhlIGV4cG9ydCB0ZW1wb3JhcnkgZm9sZGVyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbENvbnRlbnQgPSBKU09OLnN0cmluZ2lmeShjb250cm9sLCBudWxsLCAnXFx0Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZnMud3JpdGVGaWxlU3luYyhjb250cm9sUGF0aCwgY29udHJvbENvbnRlbnQpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdGUgdGhlIGludHJvLCBzdW1tYXJ5IGFuZCBzZWFyY2ggTUQgZmlsZXMgZm9yIGVhY2ggcmVzb3VyY2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBfLmVhY2goYnVuZGxlLmVudHJ5LCAoZW50cnkpID0+IHRoaXMud3JpdGVGaWxlc0ZvclJlc291cmNlcyhyb290UGF0aCwgZW50cnkucmVzb3VyY2UpKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlVGVtcGxhdGVzKHJvb3RQYXRoLCBidW5kbGUsIGltcGxlbWVudGF0aW9uR3VpZGVSZXNvdXJjZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmhpclNlcnZlckNvbmZpZy52ZXJzaW9uID09PSAnc3R1MycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy53cml0ZVN0dTNQYWdlcyhyb290UGF0aCwgaW1wbGVtZW50YXRpb25HdWlkZVJlc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLndyaXRlUjRQYWdlcyhyb290UGF0aCwgaW1wbGVtZW50YXRpb25HdWlkZVJlc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsICdEb25lIGJ1aWxkaW5nIHBhY2thZ2UnKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldElnUHVibGlzaGVyKHVzZUxhdGVzdCwgZXhlY3V0ZUlnUHVibGlzaGVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAudGhlbigoaWdQdWJsaXNoZXJMb2NhdGlvbikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmNsdWRlSWdQdWJsaXNoZXJKYXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgncHJvZ3Jlc3MnLCAnQ29weWluZyBJRyBQdWJsaXNoZXIgSkFSIHRvIHdvcmtpbmcgZGlyZWN0b3J5LicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBqYXJGaWxlTmFtZSA9IGlnUHVibGlzaGVyTG9jYXRpb24uc3Vic3RyaW5nKGlnUHVibGlzaGVyTG9jYXRpb24ubGFzdEluZGV4T2YocGF0aC5zZXApICsgMSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RKYXJQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCBqYXJGaWxlTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmNvcHlTeW5jKGlnUHVibGlzaGVyTG9jYXRpb24sIGRlc3RKYXJQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWV4ZWN1dGVJZ1B1Ymxpc2hlciB8fCAhaWdQdWJsaXNoZXJMb2NhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdjb21wbGV0ZScsICdEb25lLiBZb3Ugd2lsbCBiZSBwcm9tcHRlZCB0byBkb3dubG9hZCB0aGUgcGFja2FnZSBpbiBhIG1vbWVudC4nKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGVzdENhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXN0Q2FsbGJhY2socm9vdFBhdGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlcGxveURpciA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi93d3dyb290L2lncycsIHRoaXMuZmhpclNlcnZlcklkLCBpbXBsZW1lbnRhdGlvbkd1aWRlUmVzb3VyY2UuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmVuc3VyZURpclN5bmMoZGVwbG95RGlyKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlnUHVibGlzaGVyVmVyc2lvbiA9IHVzZUxhdGVzdCA/ICdsYXRlc3QnIDogJ2RlZmF1bHQnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb2Nlc3MgPSBzZXJ2ZXJDb25maWcuamF2YUxvY2F0aW9uIHx8ICdqYXZhJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBqYXJQYXJhbXMgPSBbJy1qYXInLCBpZ1B1Ymxpc2hlckxvY2F0aW9uLCAnLWlnJywgY29udHJvbFBhdGhdO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF1c2VUZXJtaW5vbG9neVNlcnZlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBqYXJQYXJhbXMucHVzaCgnLXR4JywgJ04vQScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgYFJ1bm5pbmcgJHtpZ1B1Ymxpc2hlclZlcnNpb259IElHIFB1Ymxpc2hlcjogJHtqYXJQYXJhbXMuam9pbignICcpfWApO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYFNwYXduaW5nIEZISVIgSUcgUHVibGlzaGVyIEphdmEgcHJvY2VzcyBhdCAke3Byb2Nlc3N9IHdpdGggcGFyYW1zICR7amFyUGFyYW1zfWApO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWdQdWJsaXNoZXJQcm9jZXNzID0gc3Bhd24ocHJvY2VzcywgamFyUGFyYW1zKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlnUHVibGlzaGVyUHJvY2Vzcy5zdGRvdXQub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZGF0YS50b1N0cmluZygpLnJlcGxhY2UodG1wLnRtcGRpciwgJ1hYWCcpLnJlcGxhY2UoaG9tZWRpciwgJ1hYWCcpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtZXNzYWdlICYmIG1lc3NhZ2UudHJpbSgpLnJlcGxhY2UoL1xcLi9nLCAnJykgIT09ICcnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsIG1lc3NhZ2UpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZ1B1Ymxpc2hlclByb2Nlc3Muc3RkZXJyLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGRhdGEudG9TdHJpbmcoKS5yZXBsYWNlKHRtcC50bXBkaXIsICdYWFgnKS5yZXBsYWNlKGhvbWVkaXIsICdYWFgnKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobWVzc2FnZSAmJiBtZXNzYWdlLnRyaW0oKS5yZXBsYWNlKC9cXC4vZywgJycpICE9PSAnJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgncHJvZ3Jlc3MnLCBtZXNzYWdlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWdQdWJsaXNoZXJQcm9jZXNzLm9uKCdlcnJvcicsIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9ICdFcnJvciBleGVjdXRpbmcgRkhJUiBJRyBQdWJsaXNoZXI6ICcgKyBlcnI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKG1lc3NhZ2UpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdlcnJvcicsIG1lc3NhZ2UpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWdQdWJsaXNoZXJQcm9jZXNzLm9uKCdleGl0JywgKGNvZGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYElHIFB1Ymxpc2hlciBpcyBkb25lIGV4ZWN1dGluZyBmb3IgJHtyb290UGF0aH1gKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsICdJRyBQdWJsaXNoZXIgZmluaXNoZWQgd2l0aCBjb2RlICcgKyBjb2RlKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgncHJvZ3Jlc3MnLCAnV29uXFwndCBjb3B5IG91dHB1dCB0byBkZXBsb3ltZW50IHBhdGguJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdjb21wbGV0ZScsICdEb25lLiBZb3Ugd2lsbCBiZSBwcm9tcHRlZCB0byBkb3dubG9hZCB0aGUgcGFja2FnZSBpbiBhIG1vbWVudC4nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ0NvcHlpbmcgb3V0cHV0IHRvIGRlcGxveW1lbnQgcGF0aC4nKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUGF0aCA9IHBhdGgucmVzb2x2ZShyb290UGF0aCwgJ2dlbmVyYXRlZF9vdXRwdXQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG91dHB1dFBhdGggPSBwYXRoLnJlc29sdmUocm9vdFBhdGgsICdvdXRwdXQnKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYERlbGV0aW5nIGNvbnRlbnQgZ2VuZXJhdGVkIGJ5IGlnIHB1Ymxpc2hlciBpbiAke2dlbmVyYXRlZFBhdGh9YCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmVtcHR5RGlyKGdlbmVyYXRlZFBhdGgsIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBDb3B5aW5nIG91dHB1dCBmcm9tICR7b3V0cHV0UGF0aH0gdG8gJHtkZXBsb3lEaXJ9YCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmNvcHkob3V0cHV0UGF0aCwgZGVwbG95RGlyLCAoZXJyKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihlcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdlcnJvcicsICdFcnJvciBjb3B5aW5nIGNvbnRlbnRzIHRvIGRlcGxveW1lbnQgcGF0aC4nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmaW5hbE1lc3NhZ2UgPSBgRG9uZSBleGVjdXRpbmcgdGhlIEZISVIgSUcgUHVibGlzaGVyLiBZb3UgbWF5IHZpZXcgdGhlIElHIDxhIGhyZWY9XCIvaW1wbGVtZW50YXRpb24tZ3VpZGUvJHt0aGlzLmltcGxlbWVudGF0aW9uR3VpZGVJZH0vdmlld1wiPmhlcmU8L2E+LmAgKyAoZG93bmxvYWRPdXRwdXQgPyAnIFlvdSB3aWxsIGJlIHByb21wdGVkIHRvIGRvd25sb2FkIHRoZSBwYWNrYWdlIGluIGEgbW9tZW50LicgOiAnJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ2NvbXBsZXRlJywgZmluYWxNZXNzYWdlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWRvd25sb2FkT3V0cHV0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBVc2VyIGluZGljYXRlZCB0aGV5IGRvbid0IG5lZWQgdG8gZG93bmxvYWQuIFJlbW92aW5nIHRlbXBvcmFyeSBkaXJlY3RvcnkgJHtyb290UGF0aH1gKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy5lbXB0eURpcihyb290UGF0aCwgKGVycikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBEb25lIHJlbW92aW5nIHRlbXBvcmFyeSBkaXJlY3RvcnkgJHtyb290UGF0aH1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgnZXJyb3InLCAnRXJyb3IgZHVyaW5nIGV4cG9ydDogJyArIGVycik7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGVzdENhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlc3RDYWxsYmFjayhyb290UGF0aCwgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9LCAxMDAwKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG59XG4iXX0=