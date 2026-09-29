/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Administrator-only user CRUD route definitions
    Author review: Done
**/
import { Router } from "express";

import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateUser,
} from "../controllers/users.controller";
import { requireAuthentication } from "../middleware/authentication";
import { requireAdministrator } from "../middleware/authorization";

const router = Router();

router.use(requireAuthentication, requireAdministrator);
router.get("/", listUsers);
router.post("/", createUser);
router.get("/:id", getUser);
router.put("/:id", updateUser);
router.patch("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
