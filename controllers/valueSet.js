const express = require('express');
const router = express.Router();
const checkJwt = require('../authHelper').checkJwt;
const request = require('request').defaults({ json: true });
const config = require('config');
const _ = require('underscore');
const FhirHelper = require('../fhirHelper');

const thisResourceType = 'ValueSet';
const fhirConfig = config.get('fhir');

router.get('/', checkJwt, (req, res) => {
    const url = req.getFhirServerUrl(thisResourceType, null, null, req.query);

    request(url, { json: true }, (error, results, body) => {
        if (error) {
            console.log('Error retrieving audit events from FHIR server: ' + error);
            return res.status(500).send('Error retrieving audit events from FHIR server');
        }

        res.send(body);
    });
});

router.post('/', checkJwt, (req, res) => {
   const createUrl = req.getFhirServerUrl(thisResourceType);

   const options = {
       url: createUrl,
       method: 'POST',
       json: true,
       body: req.body
   };

   request(options, (err, results, createBody) => {
       if (err) {
           console.log('Error from FHIR server while creating value set: ' + err);
           return res.status(500).send('Error from FHIR server while creating value set');
       }

       const location = results.headers.location || results.headers['content-location'];

       if (location) {
           request(location, (err, results, retrieveBody) => {
               if (err) {
                   console.log('Error from FHIR server while retrieving newly created value set: ' + err);
                   return res.status(500).send('Error from FHIR server while retrieving newly created value set');
               }

               res.send(retrieveBody);
           })
       } else {
           res.status(500).send('FHIR server did not respond with a location to the newly created value set');
       }
   });
});


router.put('/:id', checkJwt, (req, res) => {
    const url = req.getFhirServerUrl(thisResourceType, req.params.id);

    const options = {
        url: url,
        method: 'PUT',
        json: true,
        body: req.body
    };

    request(options, (err, results, updateBody) => {
        if (err) {
            console.log('Error from FHIR server while updating value set: ' + err);
            return res.status(500).send('Error from FHIR server while updating value set');
        }

        const location = results.headers.location || results.headers['content-location'];

        if (location) {
            request(location, (err, results, retrieveBody) => {
                if (err) {
                    console.log('Error from FHIR server while retrieving recently updated value set: ' + err);
                    return res.status(500).send('Error from FHIR server while retrieving recently updated value set');
                }

                res.send(retrieveBody);
            })
        } else {
            res.status(500).send('FHIR server did not respond with a location to the recently updated value set');
        }
    });
});

router.get('/:id', checkJwt, (req, res) => {
    const url = req.getFhirServerUrl(thisResourceType, req.params.id);

    const options = {
        url: url,
        method: 'GET'
    };

    request(options, (err, results, body) => {
        if (err) {
            console.log('Error from FHIR server while retrieving value set: ' + err);
            return res.status(500).send('Error from FHIR server while retrieving value set');
        }

        res.send(body);
    });
});

router.get('/:id/expand', checkJwt, (req, res) => {
    const valueSetUrl = req.getFhirServerUrl(thisResourceType, req.params.id);

    const valueSetOptions = {
        url: valueSetUrl,
        method: 'GET'
    };

    request(valueSetOptions, (valueSetError, valueSetResults, valueSet) => {
        if (valueSetError) {
            console.log('Error from FHIR server while retrieving value set: ' + valueSetError);
            return res.status(500).send('Error from FHIR server while retrieving value set');
        }

        const terminologyServerBase = fhirConfig.terminologyServer ? fhirConfig.terminologyServer.baseUrl : null;
        let expandUrl = FhirHelper.buildUrl(terminologyServerBase, thisResourceType, null, '$expand');

        if (!expandUrl) {
            expandUrl = req.getFhirServerUrl(thisResourceType, null, '$expand');
        }

        const expandOptions = {
            url: expandUrl,
            method: 'POST',
            body: valueSet
        };

        request(expandOptions, (expandError, expandResults, expandedValueSet) => {
            if (expandError) {
                console.log('Error from FHIR server while expanding value set: ' + expandError);
                return res.status(500).send('Error from FHIR server while expanding value set');
            }

            res.send(expandedValueSet);
        });
    });
});

router.delete('/:id', checkJwt, (req, res) => {
    const url = req.getFhirServerUrl(thisResourceType, req.params.id);

    const options = {
        url: url,
        method: 'DELETE'
    };

    request(options, (err, results, body) => {
        if (err) {
            console.log('Error from FHIR server while deleting value set: ' + err);
            return res.status(500).send('Error from FHIR server while deleting value set');
        }

        res.status(204).send();
    });
});

module.exports = router;