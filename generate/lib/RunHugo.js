var async = require('async');
var util = require('util');
var spawn = require('child_process').spawn;
var s3 = require('s3');

var syncClient = s3.createClient({
    maxAsyncS3: 20,
});

tmpDir = "/tmp/sources";
pubDir = tmpDir + "/public";

exports.handler = function(event, context) {
    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    var srcBucket = event.Records[0].s3.bucket.name;
    var srcKey    = event.Records[0].s3.object.key;
    var dstBucket = event.Records[0].s3.bucket.name.replace('input.', '');

    var isDirRe = new RegExp(/\/$/);
    var isStaticRe = new RegExp(/(^static\/|\/static\/)/);
    // don't run hugo for just static files
    if (srcKey.match(isStaticRe) !== null) {
        console.log("Key " + srcKey + " is static content, bailing out");
        context.done();
    }
    // don't run hugo for git files either
    if (srcKey.match(/^\.git\//) !== null) {
        console.log("Key " + srcKey + " is static content, bailing out");
        context.done();
    }

    async.waterfall([
    function download(next) {
        var params = {
            localDir: tmpDir,

            s3Params: {
                Bucket: srcBucket,
            },
            getS3Params: function(localfile, s3Object, callback) {
                // skip static content
                if (s3Object.Key.match(isStaticRe) !== null) {
                    callback(null, null);
                    return;
                }
                if (s3Object.Key.match(isDirRe) !== null) {
                    callback(null, null);
                    return;
                }
                callback(null, {});
            },
        };
        var downloader = syncClient.downloadDir(params);
        downloader.on('error', function(err) {
            console.error("unable to sync down:", err.stack);
            next(err);
        });
        downloader.on('end', function() {
            console.log("done downloading");
            next(null);
        });
    },
    function runHugo(next) {
        console.log("Running hugo");
        var child = spawn("./hugo", ["-v", "--source=" + tmpDir, "--destination=" + pubDir], {});
        child.stdout.on('data', function (data) {
            console.log('hugo-stdout: ' + data);
        });
        child.stderr.on('data', function (data) {
            console.log('hugo-stderr: ' + data);
        });
        child.on('error', function(err) {
            console.log("hugo failed with error: " + err);
            next(err);
        });
        child.on('close', function(code) {
            console.log("hugo exited with code: " + code);
            next(null);
        });
    },
    function upload(next) {
        var params = {
            localDir: pubDir,
            deleteRemoved: false,
            s3Params: {
                ACL: 'public-read',
                Bucket: dstBucket,
            },
        };
        var uploader = syncClient.uploadDir(params);
        uploader.on('error', function(err) {
            console.error("unable to sync up:", err.stack);
            next(err);
        });
        uploader.on('end', function() {
            console.log("done uploading");
            next(null);
        });
    },
    ], function(err) {
        if (err) console.error("Failure because of: " + err)
        else console.log("All methods in waterfall succeeded.");

        context.done();
    });
};