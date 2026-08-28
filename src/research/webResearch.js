const axios = require("axios");

/**
 * Basic web research layer.
 *
 * IMPORTANT:
 * This module does NOT invent market statistics.
 * It retrieves publicly available webpages and returns
 * the raw evidence so the AI can analyse it later.
 */

async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      },
      maxContentLength: 5 * 1024 * 1024,
    });

    return {
      success: true,
      url,
      status: response.status,
      contentType: response.headers["content-type"] || "",
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      url,
      error: error.message,
    };
  }
}

/**
 * Remove HTML tags and normalise whitespace.
 *
 * This is intentionally simple for the first version.
 * We will improve extraction later.
 */
function cleanHtml(html) {
  if (typeof html !== "string") {
    return "";
  }

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Research a list of URLs.
 */
async function researchUrls(urls) {
  const results = [];

  for (const url of urls) {
    console.log(`Researching: ${url}`);

    const page = await fetchPage(url);

    if (!page.success) {
      results.push({
        url,
        success: false,
        error: page.error,
      });

      continue;
    }

    const text = cleanHtml(page.data);

    results.push({
      url,
      success: true,
      status: page.status,
      text: text.slice(0, 20000),
    });
  }

  return results;
}

module.exports = {
  fetchPage,
  researchUrls,
  cleanHtml,
};
