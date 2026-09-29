/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Authentication and current-user route definitions
    Author review: Done
**/
import { Router } from "express";

import { getCurrentUser, postLogin, postRegister } from "../controllers/auth.controller";
import { requireAuthentication } from "../middleware/authentication";

const router = Router();

router.post("/login", postLogin);
router.post("/register", postRegister);
router.get("/me", requireAuthentication, getCurrentUser);

export default router;
