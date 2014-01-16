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

function getVideo(shot, next) {
  var socket = new net.Socket({ readable: true, writeable: true });
  socket
  .on("error", function(err) {
    console.log("socket error: " + err);
    next(err);
    return;
  })
  .on("close", function(err) {
    console.log("socket closed");
  })
  .connect(shot.port, function(err) {
    console.log("connected to camera source on port " + shot.port);
    socket.setEncoding("utf8");
    socket.write("replay " + shot.start + " " + shot.duration + " " + shotToFileName(shot) + "\n", "utf8", function(err) {
      if (err) {
        console.log("error writing to camsrc");
        next(err);
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
          next(null, result);
          return;
        } catch(e) {
          console.log("error parsing json response");
          next("error processing json response");
          return;
        }
      });
    });
  });
}

function fileNameToUrl(fileName, host) {
  return fileName.replace(/^(.*public)/, "//" + host);
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
  return binaryToSide(sideToBinary(goal.side) ^ (goal.period % 1) ^ 1);
}

function goalToShots(goal) {
  const SECS = 1000;
  var goalTime = new Date(goal.created_at).getTime();
  var side = goalToSide(goal);

  var first =  { goal: goal, position: "side", port: cameras[side].side.port, start: goalTime - 8 * SECS, duration: 10 * SECS, speed: 0.90 };
  var second = { goal: goal, position: "goal", port: cameras[side].goal.port, start: goalTime - 5 * SECS, duration:  6 * SECS, speed: 0.75 };

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


app.post("/games/:game_id/goals", cors(), function(req, res) {
  var goal = req.body.goal;
  goal.game_id = req.params.game_id;

  var shots = goalToShots(goal);
  var fileNames = shots.map(shotToFileName);
  var playlist = shots.map(function(shot) { return shotToPlayList(shot, req.headers.host); });

  if (fileNames.all(function(fileName) { return fs.existsSync(fileName); })) {
    res.json( { playlist: playlist });
  } else {
    var count = shots.length;

    shots.each(function(shot) {
      getVideo(shot, function(err, json) {
        if (err) {
          res.send(500, "error: " + err);
          return;
        }
        count -=1;
        if (count <= 0) {
          res.json( { playlist: playlist });
          return;
        }
      });
    });
  }
});

app.get("/games/:game_id/goals/new", function(req, res) {
  res.render("goals/new.jade", { game_id: req.params.game_id }, function(err, html) {
    if (err) res.end("error rendering template: " + err);
    else res.end(html);
  });
});

var config;
var camsrcs = [];
var cameras = {};

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
    });

    camsrcs.push(camsrc);

    cameras[camera.side] = cameras[camera.side] || {};
    cameras[camera.side][camera.position] = camera;
  });
}

var args = process.argv.splice(2);
processConfigFile(args[0]);

app.listen(4000);
console.log("Listening on port 4000");

