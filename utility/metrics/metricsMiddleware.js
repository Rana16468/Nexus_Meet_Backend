import { Router } from "express";

import httpStatus from "http-status";
import { metricsService } from "./metrics.service.js";

const monitorRouter = Router();

monitorRouter.get("/metrics", async (_req, res) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.status(httpStatus.CREATED).json(metrics);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch metrics" });
  }
});

export default monitorRouter;
