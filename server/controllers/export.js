"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const tmp = require("tmp");
const path = require("path");
const rp = require("request-promise");
const _ = require("underscore");
const html_1 = require("../export/html");
const controller_1 = require("./controller");
const bundle_1 = require("../export/bundle");
const promiseHelper_1 = require("../promiseHelper");
const authHelper_1 = require("../authHelper");
const FhirHelper = require("../fhirHelper");
var ExportFormats;
(function (ExportFormats) {
    ExportFormats["Bundle"] = "1";
    ExportFormats["Html"] = "2";
})(ExportFormats || (ExportFormats = {}));
class ExportOptions {
    constructor(query) {
        this.executeIgPublisher = true;
        this.useTerminologyServer = false;
        this.useLatest = false;
        this.downloadOutput = true;
        this.format = 'json';
        this.exportFormat = ExportFormats.Bundle;
        this.includeIgPublisherJar = false;
        if (query) {
            if (query.socketId) {
                this.socketId = query.socketId;
            }
            if (query.hasOwnProperty('executeIgPublisher')) {
                this.executeIgPublisher = query.executeIgPublisher.toLowerCase() === 'true';
            }
            if (query.hasOwnProperty('useTerminologyServer')) {
                this.useTerminologyServer = query.useTerminologyServer.toLowerCase() === 'true';
            }
            if (query.hasOwnProperty('useLatest')) {
                this.useLatest = query.useLatest.toLowerCase() === 'true';
            }
            if (query.hasOwnProperty('downloadOutput')) {
                this.downloadOutput = query.downloadOutput.toLowerCase === 'true';
            }
            if (query.hasOwnProperty('_format')) {
                this.format = query._format;
            }
            if (query.hasOwnProperty('exportFormat')) {
                this.exportFormat = query.exportFormat;
            }
            if (query.hasOwnProperty('includeIgPublisherJar')) {
                this.includeIgPublisherJar = query.includeIgPublisherJar.toLowerCase() === 'true';
            }
        }
    }
}
class ExportController extends controller_1.BaseController {
    constructor(baseUrl, fhirServerId, fhirVersion, fhir, io) {
        super();
        this.baseUrl = baseUrl;
        this.fhirServerId = fhirServerId;
        this.fhirVersion = fhirVersion;
        this.fhir = fhir;
        this.io = io;
    }
    static initRoutes() {
        const router = express.Router();
        router.post('/:implementationGuideId', (req, res) => {
            const controller = new ExportController(req.fhirServerBase, req.headers.fhirserver, req.fhirServerVersion, req.fhir, req.io);
            controller.exportImplementationGuide(req.params.implementationGuideId, new ExportOptions(req.query))
                .then((results) => this.handleResponse(res, results))
                .catch((err) => ExportController.handleError(err, null, res));
        });
        router.get('/:packageId', (req, res) => {
            const controller = new ExportController(req.fhirServerBase, req.headers.fhirserver, req.fhirServerVersion, req.fhir, req.io);
            controller.getExportedPackage(req.params.packageId)
                .then((results) => this.handleResponse(res, results))
                .catch((err) => ExportController.handleError(err, null, res));
        });
        router.get('/:implementationGuideId/([$])validate', authHelper_1.checkJwt, (req, res) => {
            const controller = new ExportController(req.fhirServerBase, req.headers.fhirserver, req.fhirServerVersion, req.fhir, req.io);
            controller.validate(req.params.implementationGuideId)
                .then((results) => res.send(results))
                .catch((err) => ExportController.handleError(err, null, res));
        });
        return router;
    }
    validate(implementationGuideId) {
        return new Promise((resolve, reject) => {
            const bundleExporter = new bundle_1.BundleExporter(this.baseUrl, this.fhirServerId, this.fhirVersion, this.fhir, implementationGuideId);
            let validationRequests = [];
            bundleExporter.getBundle(true)
                .then((results) => {
                validationRequests = _.map(results.entry, (entry) => {
                    const options = {
                        url: FhirHelper.buildUrl(this.baseUrl, entry.resource.resourceType, null, '$validate'),
                        method: 'POST',
                        body: entry.resource,
                        json: true,
                        simple: false,
                        resolveWithFullResponse: true
                    };
                    return {
                        resourceReference: `${entry.resource.resourceType}/${entry.resource.id}`,
                        promise: rp(options)
                    };
                });
                const promises = _.map(validationRequests, (validationRequest) => validationRequest.promise);
                return Promise.all(promises);
            })
                .then((resultSets) => {
                let validationResults = [];
                _.each(resultSets, (resultSet, index) => {
                    if (resultSet.body && resultSet.body.resourceType === 'OperationOutcome') {
                        const oo = resultSet.body;
                        const next = _.map(oo.issue, (issue) => {
                            return {
                                resourceReference: validationRequests[index].resourceReference,
                                severity: issue.severity,
                                details: issue.diagnostics
                            };
                        });
                        validationResults = validationResults.concat(next);
                    }
                });
                validationResults = _.sortBy(validationResults, (validationResult) => validationResult.severity);
                resolve(validationResults);
            })
                .catch((err) => {
                if (err.statusCode === 412) {
                    resolve(err.error);
                }
                else {
                    reject(err);
                }
            });
        });
    }
    exportBundle(implementationGuideId, format = 'json') {
        return new Promise((resolve, reject) => {
            const exporter = new bundle_1.BundleExporter(this.baseUrl, this.fhirServerId, this.fhirVersion, this.fhir, implementationGuideId);
            exporter.export(format)
                .then((response) => {
                let fileExt = '.json';
                if (format && format === 'application/xml') {
                    fileExt = '.xml';
                }
                resolve({
                    contentType: 'application/octet-stream',
                    contentDisposition: 'attachment; filename=ig-bundle' + fileExt,
                    content: response
                });
            })
                .catch((err) => reject(err));
        });
    }
    exportHtml(implementationGuideId, options) {
        return new Promise((resolve, reject) => {
            const exporter = new html_1.HtmlExporter(this.baseUrl, this.fhirServerId, this.fhirVersion, this.fhir, this.io, options.socketId, implementationGuideId);
            ExportController.htmlExports.push(exporter);
            exporter.export(options.format, options.executeIgPublisher, options.useTerminologyServer, options.useLatest, options.downloadOutput, options.includeIgPublisherJar)
                .then((response) => {
                resolve({
                    content: response
                });
                // Should be moved to a .finally() block when moving to ES2018
                const index = ExportController.htmlExports.indexOf(exporter);
                ExportController.htmlExports.splice(index);
            })
                .catch((err) => {
                reject(err);
                // Should be moved to a .finally() block when moving to ES2018
                const index = ExportController.htmlExports.indexOf(exporter);
                ExportController.htmlExports.splice(index);
            });
        });
    }
    exportImplementationGuide(implementationGuideId, options) {
        switch (options.exportFormat) {
            case ExportFormats.Bundle:
                return this.exportBundle(implementationGuideId, options.format);
                break;
            case ExportFormats.Html:
                return this.exportHtml(implementationGuideId, options);
                break;
            default:
                return Promise.reject('Unexpected export format selected: ' + options.exportFormat);
        }
    }
    getExportedPackage(packageId) {
        return new Promise((resolve, reject) => {
            const rootPath = path.join(tmp.tmpdir, packageId);
            promiseHelper_1.zip(rootPath)
                .then((buffer) => {
                resolve({
                    contentType: 'application/octet-stream',
                    contentDisposition: 'attachment; filename=ig-package.zip',
                    content: buffer
                });
                return promiseHelper_1.emptydir(rootPath);
            })
                .then(() => {
                return promiseHelper_1.rmdir(rootPath);
            })
                .catch((err) => {
                ExportController.log.error(err);
                reject(err);
            });
        });
    }
}
ExportController.htmlExports = [];
exports.ExportController = ExportController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhwb3J0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZXhwb3J0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLDJCQUEyQjtBQUMzQiw2QkFBNkI7QUFDN0Isc0NBQXNDO0FBQ3RDLGdDQUFnQztBQUNoQyx5Q0FBNEM7QUFFNUMsNkNBQTZEO0FBRzdELDZDQUFnRDtBQUNoRCxvREFBc0Q7QUFDdEQsOENBQXVDO0FBRXZDLDRDQUE0QztBQTRCNUMsSUFBSyxhQUdKO0FBSEQsV0FBSyxhQUFhO0lBQ2QsNkJBQVksQ0FBQTtJQUNaLDJCQUFVLENBQUE7QUFDZCxDQUFDLEVBSEksYUFBYSxLQUFiLGFBQWEsUUFHakI7QUFFRCxNQUFNLGFBQWE7SUFVZixZQUFZLEtBQVc7UUFSaEIsdUJBQWtCLEdBQUcsSUFBSSxDQUFDO1FBQzFCLHlCQUFvQixHQUFHLEtBQUssQ0FBQztRQUM3QixjQUFTLEdBQUcsS0FBSyxDQUFDO1FBQ2xCLG1CQUFjLEdBQUcsSUFBSSxDQUFDO1FBQ3RCLFdBQU0sR0FBcUcsTUFBTSxDQUFDO1FBQ2xILGlCQUFZLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQztRQUNwQywwQkFBcUIsR0FBRyxLQUFLLENBQUM7UUFHakMsSUFBSSxLQUFLLEVBQUU7WUFDUCxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUU7Z0JBQ2hCLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQzthQUNsQztZQUVELElBQUksS0FBSyxDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFO2dCQUM1QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFdBQVcsRUFBRSxLQUFLLE1BQU0sQ0FBQzthQUMvRTtZQUVELElBQUksS0FBSyxDQUFDLGNBQWMsQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFO2dCQUM5QyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsS0FBSyxDQUFDLG9CQUFvQixDQUFD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T0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLHFCQUFxQixFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUN2RCxNQUFNO1lBQ1Y7Z0JBQ0ksT0FBTyxPQUFPLENBQUMsTUFBTSxDQUFDLHFDQUFxQyxHQUFHLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQztTQUMzRjtJQUNMLENBQUM7SUFFTSxrQkFBa0IsQ0FBQyxTQUFpQjtRQUN2QyxPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ25DLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxTQUFTLENBQUMsQ0FBQztZQUVsRCxtQkFBRyxDQUFDLFFBQVEsQ0FBQztpQkFDUixJQUFJLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDYixPQUFPLENBQUM7b0JBQ0osV0FBVyxFQUFFLDBCQUEwQjtvQkFDdkMsa0JBQWtCLEVBQUUscUNBQXFDO29CQUN6RCxPQUFPLEVBQUUsTUFBTTtpQkFDbEIsQ0FBQyxDQUFDO2dCQUVILE9BQU8sd0JBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUM5QixDQUFDLENBQUM7aUJBQ0QsSUFBSSxDQUFDLEdBQUcsRUFBRTtnQkFDUCxPQUFPLHFCQUFLLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDM0IsQ0FBQyxDQUFDO2lCQUNELEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFO2dCQUNYLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ2hDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNoQixDQUFDLENBQUMsQ0FBQztRQUNYLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQzs7QUF0TE0sNEJBQVcsR0FBRyxFQUFFLENBQUM7QUFENUIsNENBd0xDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZXhwcmVzcyBmcm9tICdleHByZXNzJztcbmltcG9ydCAqIGFzIHRtcCBmcm9tICd0bXAnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHJwIGZyb20gJ3JlcXVlc3QtcHJvbWlzZSc7XG5pbXBvcnQgKiBhcyBfIGZyb20gJ3VuZGVyc2NvcmUnO1xuaW1wb3J0IHtIdG1sRXhwb3J0ZXJ9IGZyb20gJy4uL2V4cG9ydC9odG1sJztcbmltcG9ydCB7RXh0ZW5kZWRSZXF1ZXN0fSBmcm9tICcuL21vZGVscyc7XG5pbXBvcnQge0Jhc2VDb250cm9sbGVyLCBHZW5lcmljUmVzcG9uc2V9IGZyb20gJy4vY29udHJvbGxlcic7XG5pbXBvcnQge0ZoaXJ9IGZyb20gJ2ZoaXIvZmhpcic7XG5pbXBvcnQge1NlcnZlcn0gZnJvbSAnc29ja2V0LmlvJztcbmltcG9ydCB7QnVuZGxlRXhwb3J0ZXJ9IGZyb20gJy4uL2V4cG9ydC9idW5kbGUnO1xuaW1wb3J0IHtlbXB0eWRpciwgcm1kaXIsIHppcH0gZnJvbSAnLi4vcHJvbWlzZUhlbHBlcic7XG5pbXBvcnQge2NoZWNrSnd0fSBmcm9tICcuLi9hdXRoSGVscGVyJztcbmltcG9ydCB7UmVxdWVzdEhhbmRsZXJ9IGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0ICogYXMgRmhpckhlbHBlciBmcm9tICcuLi9maGlySGVscGVyJztcbmltcG9ydCB7QnVuZGxlLCBPcGVyYXRpb25PdXRjb21lfSBmcm9tICcuLi8uLi9zcmMvYXBwL21vZGVscy9zdHUzL2ZoaXInO1xuaW1wb3J0IHtTZXJ2ZXJWYWxpZGF0aW9uUmVzdWx0fSBmcm9tICcuLi8uLi9zcmMvYXBwL21vZGVscy9zZXJ2ZXItdmFsaWRhdGlvbi1yZXN1bHQnO1xuXG5pbnRlcmZhY2UgRXhwb3J0SW1wbGVtZW50YXRpb25HdWlkZVJlcXVlc3QgZXh0ZW5kcyBFeHRlbmRlZFJlcXVlc3Qge1xuICAgIHBhcmFtczoge1xuICAgICAgICBpbXBsZW1lbnRhdGlvbkd1aWRlSWQ6IHN0cmluZztcbiAgICB9O1xuICAgIHF1ZXJ5OiB7XG4gICAgICAgIF9mb3JtYXQ/OiBzdHJpbmc7XG4gICAgfTtcbn1cblxuaW50ZXJmYWNlIEdldEV4cG9ydGVkUGFja2FnZVJlcXVlc3QgZXh0ZW5kcyBFeHRlbmRlZFJlcXVlc3Qge1xuICAgIHBhcmFtczoge1xuICAgICAgICBwYWNrYWdlSWQ6IHN0cmluZztcbiAgICB9O1xuICAgIHF1ZXJ5OiB7XG4gICAgICAgIHNvY2tldElkPzogc3RyaW5nO1xuICAgIH07XG59XG5cbmludGVyZmFjZSBHZXRWYWxpZGF0aW9uUmVxdWVzdCBleHRlbmRzIEV4dGVuZGVkUmVxdWVzdCB7XG4gICAgcGFyYW1zOiB7XG4gICAgICAgIGltcGxlbWVudGF0aW9uR3VpZGVJZDogc3RyaW5nO1xuICAgIH07XG59XG5cbmVudW0gRXhwb3J0Rm9ybWF0cyB7XG4gICAgQnVuZGxlID0gJzEnLFxuICAgIEh0bWwgPSAnMidcbn1cblxuY2xhc3MgRXhwb3J0T3B0aW9ucyB7XG4gICAgcHVibGljIHNvY2tldElkPzogc3RyaW5nO1xuICAgIHB1YmxpYyBleGVjdXRlSWdQdWJsaXNoZXIgPSB0cnVlO1xuICAgIHB1YmxpYyB1c2VUZXJtaW5vbG9neVNlcnZlciA9IGZhbHNlO1xuICAgIHB1YmxpYyB1c2VMYXRlc3QgPSBmYWxzZTtcbiAgICBwdWJsaWMgZG93bmxvYWRPdXRwdXQgPSB0cnVlO1xuICAgIHB1YmxpYyBmb3JtYXQ6ICdqc29uJ3wneG1sJ3wnYXBwbGljYXRpb24vanNvbid8J2FwcGxpY2F0aW9uL2ZoaXIranNvbid8J2FwcGxpY2F0aW9uL3htbCd8J2FwcGxpY2F0aW9uL2ZoaXIreG1sJyA9ICdqc29uJztcbiAgICBwdWJsaWMgZXhwb3J0Rm9ybWF0ID0gRXhwb3J0Rm9ybWF0cy5CdW5kbGU7XG4gICAgcHVibGljIGluY2x1ZGVJZ1B1Ymxpc2hlckphciA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IocXVlcnk/OiBhbnkpIHtcbiAgICAgICAgaWYgKHF1ZXJ5KSB7XG4gICAgICAgICAgICBpZiAocXVlcnkuc29ja2V0SWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNvY2tldElkID0gcXVlcnkuc29ja2V0SWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5oYXNPd25Qcm9wZXJ0eSgnZXhlY3V0ZUlnUHVibGlzaGVyJykpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGVJZ1B1Ymxpc2hlciA9IHF1ZXJ5LmV4ZWN1dGVJZ1B1Ymxpc2hlci50b0xvd2VyQ2FzZSgpID09PSAndHJ1ZSc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5oYXNPd25Qcm9wZXJ0eSgndXNlVGVybWlub2xvZ3lTZXJ2ZXInKSkge1xuICAgICAgICAgICAgICAgIHRoaXMudXNlVGVybWlub2xvZ3lTZXJ2ZXIgPSBxdWVyeS51c2VUZXJtaW5vbG9neVNlcnZlci50b0xvd2VyQ2FzZSgpID09PSAndHJ1ZSc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5oYXNPd25Qcm9wZXJ0eSgndXNlTGF0ZXN0JykpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnVzZUxhdGVzdCA9IHF1ZXJ5LnVzZUxhdGVzdC50b0xvd2VyQ2FzZSgpID09PSAndHJ1ZSc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5oYXNPd25Qcm9wZXJ0eSgnZG93bmxvYWRPdXRwdXQnKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuZG93bmxvYWRPdXRwdXQgPSBxdWVyeS5kb3dubG9hZE91dHB1dC50b0xvd2VyQ2FzZSA9PT0gJ3RydWUnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuaGFzT3duUHJvcGVydHkoJ19mb3JtYXQnKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuZm9ybWF0ID0gcXVlcnkuX2Zvcm1hdDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHF1ZXJ5Lmhhc093blByb3BlcnR5KCdleHBvcnRGb3JtYXQnKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuZXhwb3J0Rm9ybWF0ID0gcXVlcnkuZXhwb3J0Rm9ybWF0O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuaGFzT3duUHJvcGVydHkoJ2luY2x1ZGVJZ1B1Ymxpc2hlckphcicpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5pbmNsdWRlSWdQdWJsaXNoZXJKYXIgPSBxdWVyeS5pbmNsdWRlSWdQdWJsaXNoZXJKYXIudG9Mb3dlckNhc2UoKSA9PT0gJ3RydWUnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgRXhwb3J0Q29udHJvbGxlciBleHRlbmRzIEJhc2VDb250cm9sbGVyIHtcbiAgICBzdGF0aWMgaHRtbEV4cG9ydHMgPSBbXTtcblxuICAgIHJlYWRvbmx5IGJhc2VVcmw6IHN0cmluZztcbiAgICByZWFkb25seSBmaGlyU2VydmVySWQ6IHN0cmluZztcbiAgICByZWFkb25seSBmaGlyVmVyc2lvbjogc3RyaW5nO1xuICAgIHJlYWRvbmx5IGZoaXI6IEZoaXI7XG4gICAgcmVhZG9ubHkgaW86IFNlcnZlcjtcblxuICAgIGNvbnN0cnVjdG9yKGJhc2VVcmw6IHN0cmluZywgZmhpclNlcnZlcklkOiBzdHJpbmcsIGZoaXJWZXJzaW9uOiBzdHJpbmcsIGZoaXI6IEZoaXIsIGlvOiBTZXJ2ZXIpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5iYXNlVXJsID0gYmFzZVVybDtcbiAgICAgICAgdGhpcy5maGlyU2VydmVySWQgPSBmaGlyU2VydmVySWQ7XG4gICAgICAgIHRoaXMuZmhpclZlcnNpb24gPSBmaGlyVmVyc2lvbjtcbiAgICAgICAgdGhpcy5maGlyID0gZmhpcjtcbiAgICAgICAgdGhpcy5pbyA9IGlvO1xuICAgIH1cblxuICAgIHB1YmxpYyBzdGF0aWMgaW5pdFJvdXRlcygpIHtcbiAgICAgICAgY29uc3Qgcm91dGVyID0gZXhwcmVzcy5Sb3V0ZXIoKTtcblxuICAgICAgICByb3V0ZXIucG9zdCgnLzppbXBsZW1lbnRhdGlvbkd1aWRlSWQnLCA8UmVxdWVzdEhhbmRsZXI+IChyZXE6IEV4cG9ydEltcGxlbWVudGF0aW9uR3VpZGVSZXF1ZXN0LCByZXMpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRXhwb3J0Q29udHJvbGxlcihyZXEuZmhpclNlcnZlckJhc2UsIHJlcS5oZWFkZXJzLmZoaXJzZXJ2ZXIsIHJlcS5maGlyU2VydmVyVmVyc2lvbiwgcmVxLmZoaXIsIHJlcS5pbyk7XG4gICAgICAgICAgICBjb250cm9sbGVyLmV4cG9ydEltcGxlbWVudGF0aW9uR3VpZGUocmVxLnBhcmFtcy5pbXBsZW1lbnRhdGlvbkd1aWRlSWQsIG5ldyBFeHBvcnRPcHRpb25zKHJlcS5xdWVyeSkpXG4gICAgICAgICAgICAgICAgLnRoZW4oKHJlc3VsdHM6IEdlbmVyaWNSZXNwb25zZSkgPT4gdGhpcy5oYW5kbGVSZXNwb25zZShyZXMsIHJlc3VsdHMpKVxuICAgICAgICAgICAgICAgIC5jYXRjaCgoZXJyKSA9PiBFeHBvcnRDb250cm9sbGVyLmhhbmRsZUVycm9yKGVyciwgbnVsbCwgcmVzKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJvdXRlci5nZXQoJy86cGFja2FnZUlkJywgPFJlcXVlc3RIYW5kbGVyPiAocmVxOiBHZXRFeHBvcnRlZFBhY2thZ2VSZXF1ZXN0LCByZXMpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRXhwb3J0Q29udHJvbGxlcihyZXEuZmhpclNlcnZlckJhc2UsIHJlcS5oZWFkZXJzLmZoaXJzZXJ2ZXIsIHJlcS5maGlyU2VydmVyVmVyc2lvbiwgcmVxLmZoaXIsIHJlcS5pbyk7XG4gICAgICAgICAgICBjb250cm9sbGVyLmdldEV4cG9ydGVkUGFja2FnZShyZXEucGFyYW1zLnBhY2thZ2VJZClcbiAgICAgICAgICAgICAgICAudGhlbigocmVzdWx0czogR2VuZXJpY1Jlc3BvbnNlKSA9PiB0aGlzLmhhbmRsZVJlc3BvbnNlKHJlcywgcmVzdWx0cykpXG4gICAgICAgICAgICAgICAgLmNhdGNoKChlcnIpID0+IEV4cG9ydENvbnRyb2xsZXIuaGFuZGxlRXJyb3IoZXJyLCBudWxsLCByZXMpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcm91dGVyLmdldCgnLzppbXBsZW1lbnRhdGlvbkd1aWRlSWQvKFskXSl2YWxpZGF0ZScsIDxSZXF1ZXN0SGFuZGxlcj4gY2hlY2tKd3QsIChyZXE6IEdldFZhbGlkYXRpb25SZXF1ZXN0LCByZXMpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRXhwb3J0Q29udHJvbGxlcihyZXEuZmhpclNlcnZlckJhc2UsIHJlcS5oZWFkZXJzLmZoaXJzZXJ2ZXIsIHJlcS5maGlyU2VydmVyVmVyc2lvbiwgcmVxLmZoaXIsIHJlcS5pbyk7XG4gICAgICAgICAgICBjb250cm9sbGVyLnZhbGlkYXRlKHJlcS5wYXJhbXMuaW1wbGVtZW50YXRpb25HdWlkZUlkKVxuICAgICAgICAgICAgICAgIC50aGVuKChyZXN1bHRzKSA9PiByZXMuc2VuZChyZXN1bHRzKSlcbiAgICAgICAgICAgICAgICAuY2F0Y2goKGVycikgPT4gRXhwb3J0Q29udHJvbGxlci5oYW5kbGVFcnJvcihlcnIsIG51bGwsIHJlcykpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcm91dGVyO1xuICAgIH1cblxuICAgIHB1YmxpYyB2YWxpZGF0ZShpbXBsZW1lbnRhdGlvbkd1aWRlSWQ6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYnVuZGxlRXhwb3J0ZXIgPSBuZXcgQnVuZGxlRXhwb3J0ZXIodGhpcy5iYXNlVXJsLCB0aGlzLmZoaXJTZXJ2ZXJJZCwgdGhpcy5maGlyVmVyc2lvbiwgdGhpcy5maGlyLCBpbXBsZW1lbnRhdGlvbkd1aWRlSWQpO1xuICAgICAgICAgICAgbGV0IHZhbGlkYXRpb25SZXF1ZXN0cyA9IFtdO1xuXG4gICAgICAgICAgICBidW5kbGVFeHBvcnRlci5nZXRCdW5kbGUodHJ1ZSlcbiAgICAgICAgICAgICAgICAudGhlbigocmVzdWx0czogQnVuZGxlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXF1ZXN0cyA9IF8ubWFwKHJlc3VsdHMuZW50cnksIChlbnRyeSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cmw6IEZoaXJIZWxwZXIuYnVpbGRVcmwodGhpcy5iYXNlVXJsLCBlbnRyeS5yZXNvdXJjZS5yZXNvdXJjZVR5cGUsIG51bGwsICckdmFsaWRhdGUnKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2R5OiBlbnRyeS5yZXNvdXJjZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNpbXBsZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZVdpdGhGdWxsUmVzcG9uc2U6IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlUmVmZXJlbmNlOiBgJHtlbnRyeS5yZXNvdXJjZS5yZXNvdXJjZVR5cGV9LyR7ZW50cnkucmVzb3VyY2UuaWR9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9taXNlOiBycChvcHRpb25zKVxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb21pc2VzID0gXy5tYXAodmFsaWRhdGlvblJlcXVlc3RzLCAodmFsaWRhdGlvblJlcXVlc3QpID0+IHZhbGlkYXRpb25SZXF1ZXN0LnByb21pc2UpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLnRoZW4oKHJlc3VsdFNldHM6IE9wZXJhdGlvbk91dGNvbWVbXSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdmFsaWRhdGlvblJlc3VsdHM6IFNlcnZlclZhbGlkYXRpb25SZXN1bHRbXSA9IFtdO1xuXG4gICAgICAgICAgICAgICAgICAgIF8uZWFjaChyZXN1bHRTZXRzLCAocmVzdWx0U2V0OiBhbnksIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVzdWx0U2V0LmJvZHkgJiYgcmVzdWx0U2V0LmJvZHkucmVzb3VyY2VUeXBlID09PSAnT3BlcmF0aW9uT3V0Y29tZScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvbyA9IDxPcGVyYXRpb25PdXRjb21lPiByZXN1bHRTZXQuYm9keTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXh0ID0gXy5tYXAob28uaXNzdWUsIChpc3N1ZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gPFNlcnZlclZhbGlkYXRpb25SZXN1bHQ+e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VSZWZlcmVuY2U6IHZhbGlkYXRpb25SZXF1ZXN0c1tpbmRleF0ucmVzb3VyY2VSZWZlcmVuY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXZlcml0eTogaXNzdWUuc2V2ZXJpdHksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXRhaWxzOiBpc3N1ZS5kaWFnbm9zdGljc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdHMgPSB2YWxpZGF0aW9uUmVzdWx0cy5jb25jYXQobmV4dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHRzID0gXy5zb3J0QnkodmFsaWRhdGlvblJlc3VsdHMsICh2YWxpZGF0aW9uUmVzdWx0KSA9PiB2YWxpZGF0aW9uUmVzdWx0LnNldmVyaXR5KTtcblxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHZhbGlkYXRpb25SZXN1bHRzKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnIuc3RhdHVzQ29kZSA9PT0gNDEyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKGVyci5lcnJvcik7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGV4cG9ydEJ1bmRsZShpbXBsZW1lbnRhdGlvbkd1aWRlSWQ6IHN0cmluZywgZm9ybWF0OiAnanNvbid8J3htbCd8J2FwcGxpY2F0aW9uL2pzb24nfCdhcHBsaWNhdGlvbi9maGlyK2pzb24nfCdhcHBsaWNhdGlvbi94bWwnfCdhcHBsaWNhdGlvbi9maGlyK3htbCcgPSAnanNvbicpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlPEdlbmVyaWNSZXNwb25zZT4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZXIgPSBuZXcgQnVuZGxlRXhwb3J0ZXIodGhpcy5iYXNlVXJsLCB0aGlzLmZoaXJTZXJ2ZXJJZCwgdGhpcy5maGlyVmVyc2lvbiwgdGhpcy5maGlyLCBpbXBsZW1lbnRhdGlvbkd1aWRlSWQpO1xuICAgICAgICAgICAgZXhwb3J0ZXIuZXhwb3J0KGZvcm1hdClcbiAgICAgICAgICAgICAgICAudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGZpbGVFeHQgPSAnLmpzb24nO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3JtYXQgJiYgZm9ybWF0ID09PSAnYXBwbGljYXRpb24veG1sJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZUV4dCA9ICcueG1sJztcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudERpc3Bvc2l0aW9uOiAnYXR0YWNobWVudDsgZmlsZW5hbWU9aWctYnVuZGxlJyArIGZpbGVFeHQsICAgICAgLy8gVE9ETzogRGV0ZXJtaW5lIGZpbGUgbmFtZVxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcmVzcG9uc2VcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAuY2F0Y2goKGVycikgPT4gcmVqZWN0KGVycikpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGV4cG9ydEh0bWwoaW1wbGVtZW50YXRpb25HdWlkZUlkOiBzdHJpbmcsIG9wdGlvbnM6IEV4cG9ydE9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlPEdlbmVyaWNSZXNwb25zZT4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZXhwb3J0ZXIgPSBuZXcgSHRtbEV4cG9ydGVyKHRoaXMuYmFzZVVybCwgdGhpcy5maGlyU2VydmVySWQsIHRoaXMuZmhpclZlcnNpb24sIHRoaXMuZmhpciwgdGhpcy5pbywgb3B0aW9ucy5zb2NrZXRJZCwgaW1wbGVtZW50YXRpb25HdWlkZUlkKTtcblxuICAgICAgICAgICAgRXhwb3J0Q29udHJvbGxlci5odG1sRXhwb3J0cy5wdXNoKGV4cG9ydGVyKTtcblxuICAgICAgICAgICAgZXhwb3J0ZXIuZXhwb3J0KG9wdGlvbnMuZm9ybWF0LCBvcHRpb25zLmV4ZWN1dGVJZ1B1Ymxpc2hlciwgb3B0aW9ucy51c2VUZXJtaW5vbG9neVNlcnZlciwgb3B0aW9ucy51c2VMYXRlc3QsIG9wdGlvbnMuZG93bmxvYWRPdXRwdXQsIG9wdGlvbnMuaW5jbHVkZUlnUHVibGlzaGVySmFyKVxuICAgICAgICAgICAgICAgIC50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHJlc3BvbnNlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFNob3VsZCBiZSBtb3ZlZCB0byBhIC5maW5hbGx5KCkgYmxvY2sgd2hlbiBtb3ZpbmcgdG8gRVMyMDE4XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gRXhwb3J0Q29udHJvbGxlci5odG1sRXhwb3J0cy5pbmRleE9mKGV4cG9ydGVyKTtcbiAgICAgICAgICAgICAgICAgICAgRXhwb3J0Q29udHJvbGxlci5odG1sRXhwb3J0cy5zcGxpY2UoaW5kZXgpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmNhdGNoKChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycik7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU2hvdWxkIGJlIG1vdmVkIHRvIGEgLmZpbmFsbHkoKSBibG9jayB3aGVuIG1vdmluZyB0byBFUzIwMThcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5kZXggPSBFeHBvcnRDb250cm9sbGVyLmh0bWxFeHBvcnRzLmluZGV4T2YoZXhwb3J0ZXIpO1xuICAgICAgICAgICAgICAgICAgICBFeHBvcnRDb250cm9sbGVyLmh0bWxFeHBvcnRzLnNwbGljZShpbmRleCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHB1YmxpYyBleHBvcnRJbXBsZW1lbnRhdGlvbkd1aWRlKGltcGxlbWVudGF0aW9uR3VpZGVJZDogc3RyaW5nLCBvcHRpb25zOiBFeHBvcnRPcHRpb25zKTogUHJvbWlzZTxHZW5lcmljUmVzcG9uc2U+IHtcbiAgICAgICAgc3dpdGNoIChvcHRpb25zLmV4cG9ydEZvcm1hdCkge1xuICAgICAgICAgICAgY2FzZSBFeHBvcnRGb3JtYXRzLkJ1bmRsZTpcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5leHBvcnRCdW5kbGUoaW1wbGVtZW50YXRpb25HdWlkZUlkLCBvcHRpb25zLmZvcm1hdCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlIEV4cG9ydEZvcm1hdHMuSHRtbDpcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5leHBvcnRIdG1sKGltcGxlbWVudGF0aW9uR3VpZGVJZCwgb3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgnVW5leHBlY3RlZCBleHBvcnQgZm9ybWF0IHNlbGVjdGVkOiAnICsgb3B0aW9ucy5leHBvcnRGb3JtYXQpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGdldEV4cG9ydGVkUGFja2FnZShwYWNrYWdlSWQ6IHN0cmluZyk6IFByb21pc2U8R2VuZXJpY1Jlc3BvbnNlPiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCByb290UGF0aCA9IHBhdGguam9pbih0bXAudG1wZGlyLCBwYWNrYWdlSWQpO1xuXG4gICAgICAgICAgICB6aXAocm9vdFBhdGgpXG4gICAgICAgICAgICAgICAgLnRoZW4oKGJ1ZmZlcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnREaXNwb3NpdGlvbjogJ2F0dGFjaG1lbnQ7IGZpbGVuYW1lPWlnLXBhY2thZ2UuemlwJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGJ1ZmZlclxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZW1wdHlkaXIocm9vdFBhdGgpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcm1kaXIocm9vdFBhdGgpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmNhdGNoKChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgRXhwb3J0Q29udHJvbGxlci5sb2cuZXJyb3IoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbn0iXX0=