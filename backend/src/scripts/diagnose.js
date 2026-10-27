import net from "node:net";
import { config } from "../config/env.js";
console.log(
  `Node ${process.version}; banco configurado: ${config.db.database}; destino: ${config.db.host}:${config.db.port}`,
);
const socket = net.connect(config.db.port, config.db.host);
socket.setTimeout(4000);
socket.once("data", (data) => {
  console.log(
    "Versão anunciada pelo servidor MySQL:",
    data.subarray(5, data.indexOf(0, 5)).toString(),
  );
  socket.end();
});
socket.on("error", (error) => {
  console.error("Conexão indisponível:", error.code);
  process.exitCode = 1;
});
socket.on("timeout", () => {
  console.error("Servidor não respondeu a tempo.");
  socket.destroy();
  process.exitCode = 1;
});
