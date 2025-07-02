# AI Evaluation Plugin for Nightscout

## Overview

The AI Evaluation plugin enhances Nightscout by adding an "AI Evaluation" tab to the Reports screen. This feature allows users to leverage Large Language Models (LLMs) to analyze their CGM (Continuous Glucose Monitoring) data and associated treatment information. Users can configure prompts to guide the LLM's analysis, focusing on patterns, potential causes for fluctuations, and recommendations for improving glucose stability.

This document serves as both a user manual and technical documentation for the plugin.

## Features

*   **New "AI Evaluation" Tab:** Integrated into the Reports section of Nightscout.
*   **Configurable Prompts:**
    *   **System Prompt:** Defines the role and general behavior of the LLM.
    *   **User Prompt Template:** The main query or instruction for the LLM, which can include a `{{CGMDATA}}` token to dynamically insert the relevant report data.
    *   Prompts are manageable via a new section in **Admin Tools**.
*   **LLM Model Selection:** Users can specify which LLM model to use (e.g., "gpt-4o", "gpt-4-turbo").
*   **Dynamic Data Injection:** The `{{CGMDATA}}` token in the user prompt is replaced with the actual JSON data from the selected report period.
*   **Debugging Mode:** An option to display the exact prompts and model sent to the LLM, shown above the LLM's response in the AI Evaluation tab.
*   **Secure API Key Handling:** The LLM API key is stored as a server-side environment variable and is not exposed to the client.

## User Guide

### 1. Configuration

#### a. Environment Variables

The following environment variables must be set on your Nightscout server. After setting or changing these, **restart your Nightscout server**.

*   `AI_LLM_KEY` (Required)
    *   **Description:** Your API key for the LLM service (e.g., OpenAI).
    *   *Example:* `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
*   `AI_LLM_API_URL` (Required)
    *   **Description:** The API endpoint URL for your chosen LLM.
    *   *Example (OpenAI compatible):* `https://api.openai.com/v1/chat/completions`
*   `AI_LLM_MODEL` (Required)
    *   **Description:** The specific model name for the LLM.
    *   *Default (if not set, but recommended to set explicitly):* `gpt-4o`
    *   *Examples:* `gpt-4o`, `gpt-4-turbo`, `claude-3-opus-20240229` (ensure compatibility with your API key/URL).
*   `AI_LLM_PROMPT` (Fallback User Prompt Template)
    *   **Description:** The default user prompt template used if no prompt is configured in the Admin UI. Must include the `{{CGMDATA}}` token.
    *   *Default:* `"Analyze the provided glucose data. Identify any patterns, suggest potential reasons for fluctuations, and recommend actions to improve glucose stability. Present the analysis clearly, using tables or bullet points where appropriate."`
*   `AI_LLM_DEBUG` (Optional)
    *   **Description:** Set to `true` to enable debugging output on the AI Evaluation report tab.
    *   *Default:* `false`
    *   When enabled, this shows the model, system prompt, user prompt template, and the final user prompt (with data injected) above the LLM's response.

#### b. Admin UI for Prompts (Recommended)

For more flexible and persistent prompt management:

1.  Navigate to **Admin Tools** in your Nightscout site (usually accessible via `/admin` if you have admin rights).
2.  Locate the section titled **"AI Evaluation Prompt Settings"**. (If this section is not visible, ensure your Nightscout server has been restarted after the plugin was deployed/updated, and try a hard refresh of your browser on the admin page.)
3.  Configure the following:
    *   **System Prompt:** Define the LLM's role and general instructions.
        *   *Example:* `You are an expert diabetes educator and data analyst. Your goal is to help the user understand their glucose patterns from the provided CGM data.`
    *   **User Prompt Template:** This is the main instruction for the LLM.
        *   **Important:** You **must** include the token `{{CGMDATA}}` exactly as written. This token will be replaced by the actual JSON data from the selected report period.
        *   *Example:* `Please analyze the following CGM data: {{CGMDATA}}. Focus on identifying periods of high variability, potential causes for hypoglycemia, and effectiveness of carbohydrate corrections. Provide actionable advice in bullet points.`
4.  Click the **"Save Prompts"** button (this is the default button for the admin section, usually labeled "Configure AI Prompts" or similar based on the action's `buttonLabel` which is "Save Prompts" in the plugin's definition).
    *   These prompts are stored in the Nightscout database and will be used for all AI evaluations.
    *   The User Prompt Template saved here overrides the `AI_LLM_PROMPT` environment variable.

### 2. Generating an AI Evaluation

1.  **Navigate to Reports:** Go to the "Reports" section of your Nightscout site.
2.  **Load Report Data:** Select any standard report type (e.g., "Day to day," "Daily Stats"), choose your desired date range and other relevant filters, and click the main "Show" button for the reports. This action loads the data that will be available for the AI evaluation.
3.  **Open AI Evaluation Tab:** In the list of report tabs, click on "AI Evaluation".
4.  **Generate Analysis:** Click the "Show AI Evaluation" button within this tab.
    *   The system will use your configured prompts (from Admin UI or fallbacks) and the loaded report data.
    *   The request is sent to the LLM. This may take a few moments.
    *   The LLM's response will be displayed in the tab. If `AI_LLM_DEBUG` is enabled, debug information will appear above the response.

### 3. Understanding the Output

*   The output is the direct response from the LLM, based on your prompts and data.
*   It may include text, lists, and potentially tables (if the LLM formats it in Markdown and your browser renders it).
*   If `AI_LLM_DEBUG` is `true`, a section above the response will show:
    *   Model used.
    *   System Prompt sent.
    *   User Prompt Template (before data injection).
    *   Final User Prompt (after `{{CGMDATA}}` was replaced).

### 4. Troubleshooting

*   **"AI Evaluation Prompt Settings" Section Missing in Admin Tools:**
    *   Ensure your Nightscout server has been **restarted** after the latest plugin code was deployed.
    *   Try a hard refresh (Ctrl+F5 or Cmd+Shift+R) of your browser on the `/admin` page.
    *   Check the Nightscout server startup logs for any errors related to loading admin plugins.
*   **Error Messages or No AI Evaluation Response:**
    *   Verify all required environment variables (`AI_LLM_KEY`, `AI_LLM_API_URL`, `AI_LLM_MODEL`) are correctly set and Nightscout was restarted.
    *   Check your System and User Prompts in the Admin UI. Ensure the User Prompt Template contains the `{{CGMDATA}}` token.
    *   Examine Nightscout server logs for detailed error messages (e.g., connection issues, API errors from the LLM, database errors).
    *   Confirm your LLM API key is valid, active, and has sufficient credits/quota for the selected model.
    *   Enable `AI_LLM_DEBUG=true`, restart, and try again. Review the displayed prompts to ensure they are correctly formed and the data seems reasonable.
*   **"Report data not loaded yet..." Message:** Always load data via a standard report's "Show" button first before using the AI Evaluation tab.
*   **Admin UI Save/Load Issues:**
    *   Ensure your Nightscout instance can connect to its MongoDB database and has write permissions.
    *   The user/role attempting to save prompts must have the `admin:api:ai_settings:edit` permission. This might need to be explicitly added to your admin role configuration. Check server logs for authorization errors if saving fails.

## Technical Documentation

### 1. New Files and Key Modifications

*   **`lib/settings.js`:**
    *   Added new settings: `ai_llm_model`, `ai_llm_debug`.
    *   `ai_llm_prompt` now serves as a fallback for the user prompt template.
    *   Added `mapTruthy` for `ai_llm_debug`.
*   **`lib/report_plugins/ai_eval.js`:**
    *   The main file for the "AI Evaluation" report tab UI and client-side logic.
    *   Stores `datastorage`, `sorteddaystoshow`, and `options` when the main report is generated.
    *   Handles the "Show AI Evaluation" button click.
    *   Makes an AJAX POST request to `/api/v1/ai_eval`.
    *   Displays the LLM response and, if `AI_LLM_DEBUG` is true, the debug information received from the server.
*   **`lib/admin_plugins/ai_settings.js`:**
    *   New admin plugin for the UI in Admin Tools to manage AI prompts.
    *   Renders textareas for system and user prompts.
    *   Fetches current prompts from `/api/v1/ai_settings/prompts` (GET).
    *   Saves prompts via `/api/v1/ai_settings/prompts` (POST).
*   **`lib/admin_plugins/index.js`:**
    *   Registered the new `ai_settings` admin plugin.
*   **`lib/api/ai_settings_api.js`:**
    *   New file defining API endpoints for managing AI prompts:
        *   `GET /api/v1/ai_settings/prompts`: Fetches prompts from MongoDB.
        *   `POST /api/v1/ai_settings/prompts`: Saves prompts to MongoDB. Requires `admin:api:ai_settings:edit` permission.
*   **`lib/api/index.js`:**
    *   Registered the `/ai_settings` API router.
    *   Modified the `/api/v1/ai_eval` (POST) endpoint:
        *   Now an `async` function.
        *   Fetches prompts from the database (via `ctx.store`) with fallback to environment variables/defaults.
        *   Replaces `{{CGMDATA}}` token in the user prompt.
        *   Uses `req.settings.ai_llm_model` for the LLM payload.
        *   If `req.settings.ai_llm_debug` is true, includes `debug_prompts` in the JSON response to the client.
        *   Uses `ctx.authorization.isPermitted('api:treatments:read')` for authorization.

### 2. Database Changes

*   A new MongoDB collection named `ai_prompt_settings` is used.
*   It typically stores a single document with `_id: "main_config"` containing:
    *   `system_prompt` (String)
    *   `user_prompt_template` (String)
    *   `updated_at` (Date)
*   The `upsert: true` option is used, so this document and collection will be created automatically on the first save if they don't exist.

### 3. API Endpoints

*   **AI Evaluation:**
    *   `POST /api/v1/ai_eval`
        *   **Request Body:** `{ reportOptions: {...}, daysData: [...] }`
        *   **Authorization:** Requires `api:treatments:read` permission.
        *   **Functionality:** Orchestrates fetching prompts, preparing data, calling the LLM, and returning the response. Includes debug information if enabled.
*   **AI Prompt Settings Management (Admin):**
    *   `GET /api/v1/ai_settings/prompts`
        *   **Authorization:** Requires `api:treatments:read` permission.
        *   **Functionality:** Returns `{ system_prompt: "...", user_prompt_template: "..." }`.
    *   `POST /api/v1/ai_settings/prompts`
        *   **Request Body:** `{ system_prompt: "...", user_prompt_template: "..." }`
        *   **Authorization:** Requires `admin:api:ai_settings:edit` permission.
        *   **Functionality:** Saves the provided prompts to the database.

### 4. Data Flow for AI Evaluation

1.  User loads data in a standard Nightscout report. This populates `storedData` in `ai_eval.js`.
2.  User clicks "Show AI Evaluation" in the AI tab.
3.  Client-side script in `ai_eval.js` sends `reportOptions` and `daysData` to `POST /api/v1/ai_eval`.
4.  Server-side `/ai_eval` endpoint:
    a.  Retrieves `AI_LLM_KEY`, `AI_LLM_API_URL`, `AI_LLM_MODEL`, `AI_LLM_DEBUG` from `req.settings`.
    b.  Fetches `system_prompt` and `user_prompt_template` from the `ai_prompt_settings` MongoDB collection.
    c.  If DB prompts are not found, uses a default system prompt and `req.settings.ai_llm_prompt` for the user template.
    d.  Replaces `{{CGMDATA}}` in the user prompt template with a JSON string of `reportOptions` and `daysData`.
    e.  Constructs the LLM payload (model, system message, final user message).
    f.  Makes a POST request to `AI_LLM_API_URL` with the payload and `AI_LLM_KEY`.
    g.  Receives the LLM's response.
    h.  Constructs a JSON response for the client, including `html_content` (LLM's answer) and optionally `debug_prompts`.
5.  Client-side script in `ai_eval.js` receives the response.
    a.  If `AI_LLM_DEBUG` is true and `debug_prompts` are present, displays them.
    b.  Displays `html_content`.

### 5. Permissions

*   Access to the AI Evaluation tab and generating evaluations is implicitly controlled by the ability to view reports (e.g., `api:treatments:read` permission for the `/api/v1/ai_eval` endpoint).
*   Viewing the configured prompts via `GET /api/v1/ai_settings/prompts` also currently uses `api:treatments:read`.
*   Saving/modifying prompts via `POST /api/v1/ai_settings/prompts` requires the permission `admin:api:ai_settings:edit`. This permission string might need to be explicitly added to admin roles in the Nightscout authorization configuration if it doesn't map to an existing wildcard.

---
This markdown file should provide a comprehensive overview for both users and developers.
Please let me know if you'd like any sections expanded or clarified!
