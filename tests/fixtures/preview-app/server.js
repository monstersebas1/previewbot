const http = require("node:http");

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("Hello PR");
});

server.listen(3000);
