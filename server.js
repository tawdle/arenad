var express = require("express");
var fs = require("fs");
var net = require("net");
var server = express();

server.get("/hello.txt", function(req, res) {
  res.send("Hello world!");
});

function copyFile(source, target, cb) {
  var cbCalled = false;

  var rd = fs.createReadStream(source);
  rd.on("error", function(err) {
    done(err);
  });
  var wr = fs.createWriteStream(target);
  wr.on("error", function(err) {
    done(err);
  });
  wr.on("close", function(ex) {
    console.log("received close event\n");
    done();
  });
  rd.pipe(wr);

  function done(err) {
    if (!cbCalled) {
      cb(err);
      cbCalled = true;
    }
  }
}

server.get("/cam0.mp4", function(req, res) {
  var socket = new net.Socket({ readable: true, writeable: true });
  socket
  .on("error", function(err) {
    res.send("We got an error: " + err);
  })
  .on("close", function(err) {
    if (err) throw "socket closed with error " + err;
  })
  .connect(2000, function(err) {
    socket.write("replay -60 30\n", "UTF-8", function(err) {
      if (err) throw "error sending to socket: " + err;
      res.writeHead(200, "Here's that replay you requested", { 'Content-Type': 'video/mp4' });
      socket.pipe(res);
    });
  });
});

server.listen(4000);
console.log("Listening on port 4000");

