import http from "node:http";
import { HOST, PORT } from "./constants.mjs";
import { handleApiRequest } from "./router.mjs";
import { warmRelayer } from "./relayer.mjs";

const server = http.createServer((req, res) => {
  handleApiRequest(req, res).catch((error) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ERROR", message: error.message }));
  });
});

warmRelayer()
  .catch(() => null)
  .finally(() => {
    server.listen(PORT, HOST, () => {
      console.log(`NINK API listening on http://${HOST}:${PORT}`);
      console.log(`  Store: ${process.env.NINK_STORE || "json"}`);
      console.log(`  Rail mode: ${process.env.NINK_RAIL_MODE || "virtual"}`);
    });
  });
