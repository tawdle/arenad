var express = require("express"),
    http = require("http"),
    net = require("net"),
    url = require("url"),
    fs = require("fs");

var app = express();

app.configure(function() {
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  //app.use(express.cookieParser());
  //app.use(express.session({ secret: 'secret goes here' }));
  app.use(express.bodyParser());
  app.use(app.router);
  //app.use(express.csrf());
  app.use(express.static(__dirname + '/public'));
});

app.post("/games/:game_id/goals", function(req, res) {
  console.log(req.body);
  var fileName = __dirname + "/public/videos/games/" + req.params.game_id + "/goal-" + req.body.goal.id + ".mp4";
  var socket = new net.Socket({ readable: true, writeable: true });
  socket
  .on("error", function(err) {
    console.log("we got an error: " + err);
    res.end("We got an error: " + err);
  })
  .on("close", function(err) {
    console.log("socket closed");
  })
  .connect(2000, function(err) {
    console.log("connected to camera source");
    socket.setEncoding("utf8");
    socket.write("replay " + /* req.body.goal.time || */ (Date.now() - 20000) + " 10000 " + fileName + "\n", "utf8", function(err) {
      if (err) {
        console.log("error writing to camsrc");
        res.end("error writing to camsrc");
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
        var result = JSON.parse(json);
        res.json(result);
      });
    });
  });
});

app.get("/games/:game_id/goals/new", function(req, res) {
  res.render("goals/new.jade", { game_id: req.params.game_id }, function(err, html) {
    if (err) res.end("error rendering template: " + err);
    else res.end(html);
  });
});

app.listen(4000);
console.log("Listening on port 4000");

