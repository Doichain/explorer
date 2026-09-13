var mongoose = require('mongoose')
  , lib = require('../lib/explorer')
  , db = require('../lib/database')
  , settings = require('../lib/settings')
  , request = require('request');

var COUNT = 5000; //number of blocks to index

function exit() {
  mongoose.disconnect();
  process.exit(0);
}

var dbString = 'mongodb://' + settings.dbsettings.user;
dbString = dbString + ':' + settings.dbsettings.password;
dbString = dbString + '@' + settings.dbsettings.address;
dbString = dbString + ':' + settings.dbsettings.port;
dbString = dbString + '/' + settings.dbsettings.database;

mongoose.connect(dbString, function(err) {
  if (err) {
    console.log('Unable to connect to database: %s', dbString);
    console.log('Aborting');
    exit();
  } else {
    request({uri: 'http://127.0.0.1:' + settings.port + '/api/getpeerinfo', json: true}, function (error, response, body) {
      lib.syncLoop(body.length, function (loop) {
        var i = loop.iteration();
        var portSplit = body[i].addr.lastIndexOf(":");
        var port = "";
        if (portSplit < 0) {
          portSplit = body[i].addr.length;
        } else {
          port = body[i].addr.substring(portSplit+1);
        }
        var address = body[i].addr.substring(0,portSplit);
        // Doichain: an -addnode entry without a port shows up in getpeerinfo as a
        // bare address. It uses the default P2P port; an empty port would make the
        // next run drop every saved peer (see the check below).
        if (port === "") port = "8338";
        db.find_peer(address, function(peer) {
          if (peer) {
            if (isNaN(peer['port']) || peer['port'].length < 2 || peer['country'].length < 1 || peer['country_code'].length < 1) {
              db.drop_peers(function() {
                console.log('Saved peers missing ports or country, dropping peers. Re-reun this script afterwards.');
                exit();
              });
            }
            // peer already exists
            loop.next();
          } else {
            // Doichain: reallyfreegeoip.org answers node clients with a Cloudflare
            // challenge (HTTP 403), so every peer was stored without a country --
            // and the next run then dropped them all. ipwho.is returns the same two
            // fields. A failed lookup stores a placeholder rather than an empty
            // country, for the same reason.
            var host = address.replace(/^\[|\]$/g, '');
            request({uri: 'https://ipwho.is/' + host + '?fields=success,country,country_code', json: true}, function (error, response, geo) {
              var ok = !error && geo && geo.success && geo.country && geo.country_code;
              db.create_peer({
                address: address,
                port: port,
                protocol: body[i].version,
                version: body[i].subver.replace('/', '').replace('/', ''),
                country: ok ? geo.country : 'Unknown',
                country_code: ok ? geo.country_code : '--'
              }, function(){
                loop.next();
              });
            });
          }
        });
      }, function() {
        exit();
      });
    });
  }
});
