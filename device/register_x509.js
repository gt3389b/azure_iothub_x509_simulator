// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

'use strict';

require('dotenv').config();
var async = require('async');
var assert = require('assert');
var uuid = require('uuid');
var chalk = require('chalk');
var fs = require('fs');
var crypto = require('crypto');
var debug = require('debug')('reg');
var Http = require('azure-iot-provisioning-device-http').Http;
//var Amqp = require('azure-iot-provisioning-device-amqp').Amqp;
//var AmqpWs = require('azure-iot-provisioning-device-amqp').AmqpWs;
var Mqtt = require('azure-iot-provisioning-device-mqtt').Mqtt;
var MqttWs = require('azure-iot-provisioning-device-mqtt').MqttWs;
var ProvisioningDeviceClient = require('azure-iot-provisioning-device').ProvisioningDeviceClient;
var ProvisioningServiceClient = require('azure-iot-provisioning-service').ProvisioningServiceClient;
var X509Security = require('azure-iot-security-x509').X509Security;
var Registry = require('azure-iothub').Registry;
var DeviceClient = require('azure-iot-device').Client;
var X509AuthenticationProvider = require('azure-iot-device').X509AuthenticationProvider;
var Message = require('azure-iot-device').Message;
var certHelper = require('./cert_helper');

var idScope = process.env.AZURE_DPS_IDSCOPE;
var provisioningConnectionString = process.env.AZURE_DPS_CS;
var registryConnectionString = process.env.AZURE_IOTHUB_CS;
var provisioningHost = process.env.AZURE_DPS_HOSTNAME;
var iothubHost = process.env.AZURE_IOTHUB_HOST;

var provisioningServiceClient = ProvisioningServiceClient.fromConnectionString(provisioningConnectionString);
var registry = Registry.fromConnectionString(registryConnectionString);

var X509IndividualTransports = [ MqttWs ];

var selfSignedCert;
var x509DeviceId;
var x509RegistrationId;

var createAllCerts = function(callback) {
  var id = uuid.v4();
  x509DeviceId = id;
  x509RegistrationId = id;

  async.waterfall([
    function(callback) {
      debug('creating self-signed cert ' +id);
      certHelper.createSelfSignedCert(x509RegistrationId, function(err, cert) {
         console.log(chalk.green('saving cert to cert/' + x509RegistrationId + '_cert.pem.'));
         fs.writeFileSync('cert/'+x509RegistrationId + '_cert.pem', cert.cert);
         console.log(chalk.green('saving key to cert/' + x509RegistrationId + '_key.pem.'));
         fs.writeFileSync('cert/'+x509RegistrationId + '_key.pem', cert.key);
        selfSignedCert = cert;
        callback(err);
      });
    },
    function(callback) {
      debug('sleeping to account for clock skew');
      //setTimeout(callback, 60000);
      setTimeout(callback, 2000);
    }
  ], callback);
};


var X509Individual = function() {

  var self = this;

  this.transports = X509IndividualTransports;

   /*
    *  Initialize
    */
  this.initialize = function (callback) {
    self._cert = selfSignedCert;
    self.deviceId = x509DeviceId;
    self.registrationId = x509RegistrationId;
    callback();
  };

   /*
    *  Enroll
    */
  this.enroll = function (callback) {
    self._testProp = uuid.v4();
    var enrollment = {
      registrationId: self.registrationId,
      deviceId: self.deviceId,
      attestation: {
        type: 'x509',
        x509: {
          clientCertificates: {
            primary: {
              certificate: self._cert.cert
            }
          }
        }
      },
      initialTwin: {
        properties: {
          desired: {
            testProp: self._testProp
          }
        }
      }
    };

    provisioningServiceClient.createOrUpdateIndividualEnrollment(enrollment, function (err) {
      if (err) {
        callback(err);
      } else {
        callback();
      }
    });
  };

   /*
    *  Register
    */
  this.register = function (Transport, callback) {
    var securityClient = new X509Security(self.registrationId, self._cert);
    var transport = new Transport();
    var provisioningDeviceClient = ProvisioningDeviceClient.create(provisioningHost, idScope, transport, securityClient);
    provisioningDeviceClient.register(function (err, result) {
      callback(err, result);
    });
  };

  this.send = function(Transport, callback) {
      var Protocol = require('azure-iot-device-mqtt').MqttWs;

      var connectionString = 'HostName=rdliothub01.azure-devices.net;DeviceId='+self.deviceId+';x509=true';
      var client = DeviceClient.fromConnectionString(connectionString, Protocol);
      var connectCallback = function (err) {
         if (err) {
            console.error('Could not connect: ' + err.message);
         } else {
            console.log('Client connected');

            // Create a message and send it to the IoT Hub every second
            var sendInterval = setInterval(function () {
               var windSpeed = 10 + (Math.random() * 4); // range: [10, 14]
               var temperature = 20 + (Math.random() * 10); // range: [20, 30]
               var humidity = 60 + (Math.random() * 20); // range: [60, 80]
               var data = JSON.stringify({ deviceId: self.deviceId, windSpeed: windSpeed, temperature: temperature, humidity: humidity });
               var message = new Message(data);
               message.properties.add('temperatureAlert', (temperature > 28) ? 'true' : 'false');
               console.log('Sending message: ' + message.getData());
               client.sendEvent(message, function printResult(err, res) {
                  if (err) console.log('SEND error: ' + err.toString());
                  if (res) console.log('SEND status: ' + res.constructor.name);
                  clearInterval(sendInterval);
                  client.close();
                  callback();
               });
            }, 2000);

            client.on('error', function (err) {
               console.error(err.message);
            });
         }
      }

      client.setOptions(self._cert);
      client.open(connectCallback);
  }

   /*
    *  Cleanup
    */
  this.cleanup = function (callback) {
    debug('deleting enrollment');
    provisioningServiceClient.deleteIndividualEnrollment(self.registrationId, function (err) {
      if (err) {
        debug('ignoring deleteIndividualEnrollment error');
      }
      debug('deleting device');
      registry.delete(self.deviceId, function (err) {
        if (err) {
          debug('ignoring delete error');
        }
        debug('done with X509 individual cleanup');
        callback();
      });
    });
  };
};

var do_it = function() {
  [
    {
      testName: 'x509 individual enrollment with Self Signed Certificate',
      testObj: new X509Individual()
    },
  ].forEach(function(config) {

     config.testObj.transports.forEach(function (Transport) {
        async.waterfall([
           function(callback) {
              createAllCerts(callback);
           },
           function(callback) {
              debug('initializing');
              config.testObj.initialize(callback);
           },
           function(callback) {
              debug('enrolling');
              config.testObj.enroll(callback);
           },
           function(callback) {
              debug('registering device');
              config.testObj.register(Transport, callback);
           },
           function(result, callback) {
              debug('success registering device');
              debug(JSON.stringify(result,null,'  '));
              debug('getting twin');
              registry.getTwin(config.testObj.deviceId,function(err, twin) {
                 debug(twin);
                 callback(err, twin);
              });
           },
           function(twin, callback) {
              debug('asserting twin contents');
              assert.strictEqual(twin.properties.desired.testProp, config.testObj._testProp);
              callback();
           },
           function(callback) {
              config.testObj.send(Transport, callback);
           },
           function(callback) {
              debug('sleeping before delete');
              setTimeout(callback, 2000);
           },
           function(callback) {
              debug('cleaningup');
              config.testObj.cleanup(callback);
           },
        ]);
     });
  });
}

do_it();
