import { handleApiRequest } from "../src/router.mjs";

export default async function handler(req, res) {
  try {
    await handleApiRequest(req, res);
  } catch (error) {
    res.status(500).json({ status: "ERROR", message: error.message });
  }
}
