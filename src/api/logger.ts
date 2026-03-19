/**
 * Application logger — Winston with optional BetterStack (Logtail) transport.
 *
 * When BETTERSTACK_TOKEN is set, all NestJS log output is shipped to
 * BetterStack Logs in addition to the local console. If the token is absent
 * (local dev without an account), only console output is used.
 *
 * Usage: pass AppLogger to NestFactory.create() as the logger option.
 */

import { WinstonModule }    from "nest-winston";
import { createLogger, transports, format } from "winston";
import { Logtail }          from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";

const loggerTransports: any[] = [
  new transports.Console({
    format: format.combine(
      format.colorize(),
      format.timestamp({ format: "HH:mm:ss" }),
      format.printf(({ level, message, timestamp, context }) =>
        `${timestamp} [${context ?? "App"}] ${level}: ${message}`
      ),
    ),
  }),
];

if (process.env.BETTERSTACK_TOKEN) {
  const logtail = new Logtail(process.env.BETTERSTACK_TOKEN);
  loggerTransports.push(new LogtailTransport(logtail));
}

export const AppLogger = WinstonModule.createLogger(
  createLogger({
    level:  "info",
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.json(),
    ),
    transports: loggerTransports,
  })
);
