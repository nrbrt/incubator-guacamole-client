/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Provides the ManagedFileUpload class used by the guacClientManager service.
 */
angular.module('client').factory('ManagedFileUpload', ['$rootScope', '$injector',
    function defineManagedFileUpload($rootScope, $injector) {

    // Required types
    var ManagedFileTransferState = $injector.get('ManagedFileTransferState');

    // Required services
    var $window = $injector.get('$window');

    /**
     * The maximum number of bytes to include in each blob for the Guacamole
     * file stream. Note that this, along with instruction opcode and protocol-
     * related overhead, must not exceed the 8192 byte maximum imposed by the
     * Guacamole protocol.
     *
     * @type Number
     */
    var STREAM_BLOB_SIZE = 4096;

    /**
     * Object which serves as a surrogate interface, encapsulating a Guacamole
     * file upload while it is active, allowing it to be detached and
     * reattached from different client views.
     * 
     * @constructor
     * @param {ManagedFileUpload|Object} [template={}]
     *     The object whose properties should be copied within the new
     *     ManagedFileUpload.
     */
    var ManagedFileUpload = function ManagedFileUpload(template) {

        // Use empty object by default
        template = template || {};

        /**
         * The current state of the file transfer stream.
         *
         * @type ManagedFileTransferState
         */
        this.transferState = template.transferState || new ManagedFileTransferState();

        /**
         * The mimetype of the file being transferred.
         *
         * @type String
         */
        this.mimetype = template.mimetype;

        /**
         * The filename of the file being transferred.
         *
         * @type String
         */
        this.filename = template.filename;

        /**
         * The number of bytes transferred so far.
         *
         * @type Number
         */
        this.progress = template.progress;

        /**
         * The total number of bytes in the file.
         *
         * @type Number
         */
        this.length = template.length;

    };

    /**
     * Converts the given bytes to a base64-encoded string.
     * 
     * @param {Uint8Array} bytes A Uint8Array which contains the data to be
     *                           encoded as base64.
     * @return {String} The base64-encoded string.
     */
    var getBase64 = function getBase64(bytes) {

        var data = "";

        // Produce binary string from bytes in buffer
        for (var i=0; i<bytes.byteLength; i++)
            data += String.fromCharCode(bytes[i]);

        // Convert to base64
        return $window.btoa(data);

    };

    /**
     * Creates a new ManagedFileUpload which uploads the given file to the
     * server through the given Guacamole client.
     * 
     * @param {Guacamole.Client} client
     *     The Guacamole client through which the file is to be uploaded.
     * 
     * @param {File} file
     *     The file to upload.
     *     
     * @param {Object} [object]
     *     The object to upload the file to, if any, such as a filesystem
     *     object.
     *
     * @param {String} [streamName]
     *     The name of the stream to upload the file to. If an object is given,
     *     this must be specified.
     *
     * @return {ManagedFileUpload}
     *     A new ManagedFileUpload object which can be used to track the
     *     progress of the upload.
     */
    ManagedFileUpload.getInstance = function getInstance(client, file, object, streamName) {

        var managedFileUpload = new ManagedFileUpload();

        // Construct reader for file
        var reader = new FileReader();
        reader.onloadend = function fileContentsLoaded() {

            // Open file for writing
            var stream;
            if (!object)
                stream = client.createFileStream(file.type, file.name);

            // If object/streamName specified, upload to that instead of a file
            // stream
            else
                stream = object.createOutputStream(file.type, streamName);

            var valid = true;
            var bytes = new Uint8Array(reader.result);
            var offset = 0;

            $rootScope.$apply(function uploadStreamOpen() {

                // Init managed upload
                managedFileUpload.filename = file.name;
                managedFileUpload.mimetype = file.type;
                managedFileUpload.progress = 0;
                managedFileUpload.length   = bytes.length;

                // Notify that stream is open
                ManagedFileTransferState.setStreamState(managedFileUpload.transferState,
                    ManagedFileTransferState.StreamState.OPEN);

            });

            // Invalidate stream on all errors
            // Continue upload when acknowledged
            stream.onack = function ackReceived(status) {

                // Handle errors 
                if (status.isError()) {
                    valid = false;
                    $rootScope.$apply(function uploadStreamError() {
                        ManagedFileTransferState.setStreamState(managedFileUpload.transferState,
                            ManagedFileTransferState.StreamState.ERROR,
                            status.code);
                    });
                }

                // Abort upload if stream is invalid
                if (!valid)
                    return false;

                // Encode packet as base64
                var slice = bytes.subarray(offset, offset + STREAM_BLOB_SIZE);
                var base64 = getBase64(slice);

                // Write packet
                stream.sendBlob(base64);

                // Advance to next packet
                offset += STREAM_BLOB_SIZE;

                $rootScope.$apply(function uploadStreamProgress() {

                    // If at end, stop upload
                    if (offset >= bytes.length) {
                        stream.sendEnd();
                        managedFileUpload.progress = bytes.length;

                        // Upload complete
                        ManagedFileTransferState.setStreamState(managedFileUpload.transferState,
                            ManagedFileTransferState.StreamState.CLOSED);

                        // Notify of upload completion
                        $rootScope.$broadcast('guacUploadComplete', file.name);

                    }

                    // Otherwise, update progress
                    else
                        managedFileUpload.progress = offset;

                });

            }; // end ack handler

        };
        reader.readAsArrayBuffer(file);

        return managedFileUpload;

    };

    return ManagedFileUpload;

}]);