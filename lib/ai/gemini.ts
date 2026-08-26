import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing");
}

const ai = new GoogleGenAI({ apiKey });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error
  ) {
    const status = (error as { status?: unknown }).status;

    if (typeof status === "number") {
      return status;
    }
  }

  return null;
}

function isTemporaryError(error: unknown) {
  const status = getStatus(error);

  return status === 500 || status === 503;
}

function isQuotaError(error: unknown) {
  const status = getStatus(error);

  return status === 429;
}

async function generateWithRetry(
  model: string,
  prompt: string,
  maxRetries = 2
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[Gemini] ${model} attempt ${attempt}/${maxRetries}`
      );

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text;

      if (!text) {
        throw new Error("Gemini returned an empty response");
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error;

      const status = getStatus(error);

      console.error(
        `[Gemini] ${model} failed with status ${status}:`,
        error
      );

      /*
       * IMPORTANT:
       *
       * 429 means quota/rate limit.
       * Do NOT hammer the API with retries.
       */
      if (isQuotaError(error)) {
        throw error;
      }

      /*
       * Only retry temporary server failures.
       */
      if (!isTemporaryError(error)) {
        throw error;
      }

      if (attempt < maxRetries) {
        await sleep(2000 * attempt);
      }
    }
  }

  throw lastError;
}

export async function generateClinicalAssessment(
  prompt: string
) {
  const primary =
    process.env.GEMINI_MODEL ||
    "gemini-3.5-flash-lite";

  const fallback =
    process.env.GEMINI_FALLBACK_MODEL ||
    "gemini-3.1-flash-lite";

  try {
    return {
      success: true,
      model: primary,
      data: await generateWithRetry(
        primary,
        prompt,
        2
      ),
    };
  } catch (primaryError) {
    console.error(
      "[Gemini] Primary model failed:",
      primaryError
    );

    /*
     * If this is a quota problem, don't immediately
     * hammer another model with the same huge prompt.
     *
     * The caller will use the clinical database fallback.
     */
    if (isQuotaError(primaryError)) {
      return {
        success: false,
        quotaExceeded: true,
        model: primary,
        data: null,
        error: primaryError,
      };
    }

    try {
      return {
        success: true,
        model: fallback,
        data: await generateWithRetry(
          fallback,
          prompt,
          1
        ),
      };
    } catch (fallbackError) {
      return {
        success: false,
        quotaExceeded: isQuotaError(fallbackError),
        model: null,
        data: null,
        error: fallbackError,
      };
    }
  }
}