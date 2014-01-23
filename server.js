var express = require("express"),
    http = require("http"),
    net = require("net"),
    url = require("url"),
    fs = require("fs"),
    cors = require("cors"),
    spawn = require('child_process').spawn;

var app = express();

app.configure(function() {
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  //app.use(express.cookieParser());
  //app.use(express.session({ secret: 'secret goes here' }));
  app.use(express.logger());
  app.use(express.bodyParser());
  app.use(app.router);
  //app.use(express.csrf());
  app.use(express.static(__dirname + '/public'));
});

var filesInProgress = [];

function getVideo(shot, next) {
  var fileName = shotToFileName(shot);

  if (filesInProgress.indexOf(fileName) >= 0) {
    next("currently producing requested video");
    return;
  }

  filesInProgress.push(fileName);

  function done(err, arg) {
    var index = filesInProgress.indexOf(shotToFileName(shot));
    if (index >= 0) {
      filesInProgress.splice(index, 1);
    }
    next(err, arg);
  }

  var socket = new net.Socket({ readable: true, writeable: true });
  socket
  .on("error", function(err) {
    console.log("socket error: " + err);
    done(err);
    return;
  })
  .on("close", function(err) {
    console.log("socket closed");
  })
  .connect(shot.port, function(err) {
    console.log("connected to camera source on port " + shot.port);
    socket.setEncoding("utf8");
    socket.write("replay " + shot.start + " " + shot.duration + " " + fileName + "\n", "utf8", function(err) {
      if (err) {
        console.log("error writing to camsrc");
        done(err);
        return;
      }

      console.log("request sent to camera source");

      var json = "";

      socket
      .on("data", function(chunk) {
        json += chunk;
      })
      .on("end", function() {
        console.log("We got result from camera source: " + json);
        socket.end();
        try {
          var result = JSON.parse(json);
          done(null, result);
          return;
        } catch(e) {
          console.log("error parsing json response");
          done("error processing json response");
          return;
        }
      });
    });
  });
}

function fileNameToUrl(fileName, host) {
  return fileName.replace(/^(.*public)/, "http://" + host);
}

function sideToBinary(side) {
  return { "home": 0, "visiting": 1 }[side];
}

function binaryToSide(bin) {
  return [ "home", "visiting"][bin];
}

function goalToSide(goal) {
  // In the 0th period, the interesting side is the one opposite the team that scored.
  // And it alternates every period.
  return binaryToSide(sideToBinary(goal.side) ^ (Number(goal.period) % 2) ^ 1);
}

function goalToShots(goal) {
  var SECS = 1000;
  var goalTime = new Date(goal.created_at).getTime();
  var side = goalToSide(goal);

  var first =  { goal: goal, position: "side", port: cameras[side].side.port, start: goalTime - 8 * SECS, duration: 10 * SECS, speed: 0.90 };
  var second = { goal: goal, position: "goal", port: cameras[side].goal.port, start: goalTime - 8 * SECS, duration: 10 * SECS, speed: 0.75 };

  return [first, second];
}

function shotToFileName(shot) {
  return __dirname + "/public/videos/games/" + shot.goal.game_id + 
    "/goal-" + shot.goal.id + "-" + shot.position + ".mp4";
}

function shotToUrl(shot, host) {
  return fileNameToUrl(shotToFileName(shot), host);
}

function shotToPlaylist(shot, host) {
  return { file: shotToUrl(shot, host), speed: shot.speed };
}

function goalToShotsFileNamesAndPlaylist(goal, host) {
  var shots = goalToShots(goal),
      fileNames = shots.map(shotToFileName),
      playlist = shots.map(function(shot) { return shotToPlaylist(shot, host); });

  return {
    shots: shots,
    fileNames: fileNames,
    playlist: playlist
  };
}


function filesBeingProduced(fileNames) {
  return fileNames.some(function(fileName) { return filesInProgress.indexOf(fileName) >= 0; });
}

function filesExist(fileNames) {
  return fileNames.every(function(fileName) { return fs.existsSync(fileName); });
}

app.post("/games/:game_id/goals", cors(), function(req, res) {

  console.log("processing post request");

  var goal = req.body.goal;
  goal.game_id = req.params.game_id;

  var data = goalToShotsFileNamesAndPlaylist(goal, req.headers.host);

  if (filesExist(data.fileNames) && !filesBeingProduced(data.fileNames)) {
    console.log("sending playlist for already-existing files");
    res.json( { playlist: data.playlist });
    return;
  } else {
    if (req.connection.remoteAddress != "127.0.0.1") {
      res.send(403, "Production requests accepted only from localhost");
      return;
    }

    var count = data.shots.length;
    var error = false;

    data.shots.forEach(function(shot) {
      if (error) return;

      getVideo(shot, function(err, json) {
        if (err) {
          res.send(err == "currently producing requested video" ? 503 : 500, "error: " + err);
          error = true;
          return;
        }
        count -=1;
        if (count <= 0 && !error) {
          console.log("sending complete playlist");
          res.json( { playlist: data.playlist });
          return;
        }
      });
    });
  }
});

var config;
var children = [];
var cameras = {};

process.on('exit', function() {
  console.log('exit signalled, killing', children.length, 'child processes');
  children.forEach(function(child) {
    child.kill();
  });
});

function processConfigFile(name) {
  config = JSON.parse(fs.readFileSync("config/" + name + ".json", "utf8"));

  console.log("Processing configuration for server " + config.serverName);

  config.cameras.forEach(function(camera) {
    console.log("spawning " + config.command + " " + JSON.stringify(camera.args));
    camsrc = spawn(config.command, camera.args, { stdio: "inherit" });
    camsrc.on("error", function(err) {
      console.log("camsrc error: " + err.message);
      throw err;
    });
    camsrc.on("exit", function(err) {
      console.log("camsrc exit: " + err);
      throw "camera exited unexpectedly";
    });

    children.push(camsrc);

    cameras[camera.side] = cameras[camera.side] || {};
    cameras[camera.side][camera.position] = camera;
  });
}

var args = process.argv.splice(2);
processConfigFile(args[0]);

app.listen(4000);
console.log("Listening on port 4000");

