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
*   **Token Usage Tracking:** Automatically tracks the number of tokens consumed and API calls made to the LLM, viewable in Admin Tools.

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

#### c. Viewing AI Usage Statistics (Admin Tools)

A new section in Admin Tools allows you to monitor LLM usage:

1.  Navigate to **Admin Tools** in your Nightscout site.
2.  Locate the section titled **"AI Usage Statistics"**.
3.  This section displays a table with:
    *   **Month (YYYY-MM):** The calendar month of usage.
    *   **Total Tokens Consumed:** The sum of tokens used in that month (according to the LLM API response).
    *   **Total API Calls:** The number of successful calls to the LLM in that month.
    *   **Last Updated (UTC):** The timestamp of the most recent usage record for that month.
4.  This data helps monitor the volume of LLM interactions. Cost estimation is not directly provided in this view but can be inferred from token counts if you know your LLM provider's pricing.

### 2. Generating an AI Evaluation

1.  **Navigate to Reports:** Go to the "Reports" section of your Nightscout site.
2.  **Load Report Data:** Select any standard report type (e.g., "Day to day," "Daily Stats"), choose your desired date range and other relevant filters, and click the main "Show" button for the reports. This action loads the data that will be available for the AI evaluation.
3.  **Open AI Evaluation Tab:** In the list of report tabs, click on "AI Evaluation".
    *   Upon opening the tab, the plugin will automatically check for all required configurations (API URL, Model, System Prompt, User Prompt Template).
    *   If any settings are missing, a detailed error message will be displayed, guiding you on where to configure each item.
    *   If all settings are correctly configured, a confirmation message will appear.
4.  **Automatic Analysis:**
    *   Once the main report data (from step 2) is loaded and all AI settings are confirmed to be correct, the AI evaluation will **automatically begin**. There is no separate "Show AI Evaluation" button to click in this tab.
    *   The system will display "Loading AI evaluation..." while it processes the data and communicates with the LLM.
    *   The LLM's response will then be displayed in the main content area of the tab.

### 3. Understanding the Output

*   **AI Evaluation:** The main content area will show the direct response from the LLM, based on your prompts and data. This may include text, lists, and potentially tables.
*   **Token Usage:** Information about the number of tokens used for the current evaluation will be displayed (e.g., "Tokens used for this evaluation: XXXX"). This can help you monitor usage.
*   **Debug Information (If Enabled):** If `AI_LLM_DEBUG` is set to `true` (see Configuration section), a dedicated "AI Debug Info" section will appear above the AI's response. This section will display:
    *   **Model:** The LLM model used for the request.
    *   **System Prompt:** The exact system prompt sent to the LLM.
    *   **Final User Prompt (with data injected):** The complete user prompt after the `{{CGMDATA}}` token was replaced with your actual report data. This is very useful for understanding exactly what information the LLM received.
    *   *(The User Prompt Template as stored in settings is not directly shown here, but the Final User Prompt reflects its use).*

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
    *   The user/role attempting to save prompts must have the `admin:api:ai_settings:edit` permission.
        *   Standard Nightscout `admin` roles typically have wildcard (`*`) permissions, which includes this.
        *   If you are using custom administrative roles, you **must** ensure that the role assigned to users managing AI prompts includes the exact permission string `admin:api:ai_settings:edit`. This can usually be done via the "Roles" section in the Admin Tools of your Nightscout site.
        *   Check Nightscout server logs for authorization errors (e.g., "Unauthorized" or messages related to permissions) if saving fails.
        *   The system now includes a retry mechanism (up to 3 attempts with increasing delays) for saving prompts if initial database write acknowledgments fail. If saving still fails after retries, server logs will show multiple attempt failures and potentially more detailed error information from the database driver. Persistent failures after retries may indicate a more significant issue with the MongoDB connection or server on your hosting platform.

## Technical Documentation

### 1. New Files and Key Modifications

*   **`lib/settings.js`:**
    *   Added new settings: `ai_llm_model`, `ai_llm_debug`.
    *   `ai_llm_prompt` now serves as a fallback for the user prompt template.
    *   Added `mapTruthy` for `ai_llm_debug`.
*   **`lib/report_plugins/ai_eval.js`:**
    *   The main file for the "AI Evaluation" report tab UI and client-side logic.
    *   **UI Changes:**
        *   Removed the dedicated "Show AI Evaluation" button.
        *   Added new HTML elements: `#ai-eval-status-area` for configuration status and errors, `#ai-eval-debug-info` for debug output, and `#ai-eval-results` for LLM responses.
    *   **Automatic Trigger:**
        *   Performs a comprehensive settings check (client settings, server prompts via API) when the tab is activated.
        *   Displays detailed error messages if settings are missing, or a success message if all are configured.
        *   Automatically triggers the AI evaluation via the `report()` function when main report data is available and all settings are valid.
    *   **Data Payload:**
        *   Constructs a detailed JSON payload for the `{{CGMDATA}}` token. This includes `reportSettings` (targets, units, dates, report name), `entries` (SGV, MBG), `treatments` (insulin, carbs, notes, timestamps), `profile` data (timezone, basal, CR, ISF, fetched via `client.profile()`), and `deviceStatus` data.
    *   **AJAX Call & Display:**
        *   Makes an AJAX POST request to `/api/v1/ai_eval` with the constructed data payload.
        *   Displays the LLM's HTML response.
        *   If `AI_LLM_DEBUG` is true, displays formatted debug information (model, system prompt, final user prompt with data) in `#ai-eval-debug-info`.
        *   Displays the `tokens_used` for the current request.
*   **`lib/admin_plugins/ai_settings.js`:**
    *   New admin plugin for the UI in Admin Tools to manage AI prompts.
    *   Renders textareas for system and user prompts.
    *   Fetches current prompts from `/api/v1/ai_settings/prompts` (GET).
    *   Saves prompts via `/api/v1/ai_settings/prompts` (POST).
*   **`lib/admin_plugins/ai_usage_viewer.js`:** (New)
    *   Admin plugin to display monthly AI token usage statistics.
    *   Fetches data from `/api/v1/ai_usage/monthly_summary`.
*   **`lib/admin_plugins/index.js`:**
    *   Registered the `ai_settings` and `ai_usage_viewer` admin plugins.
*   **`lib/api/ai_settings_api.js`:**
    *   New file defining API endpoints for managing AI prompts:
        *   `GET /api/v1/ai_settings/prompts`: Fetches prompts from MongoDB.
        *   `POST /api/v1/ai_settings/prompts`: Saves prompts to MongoDB. Requires `admin:api:ai_settings:edit` permission.
*   **`lib/api/ai_usage_api.js`:** (New)
    *   New file defining API endpoints for tracking AI usage:
        *   `POST /api/v1/ai_usage/record`: Records token usage. Called internally by `/api/v1/ai_eval`.
        *   `GET /api/v1/ai_usage/monthly_summary`: Retrieves aggregated monthly usage data.
*   **`lib/api/index.js`:**
    *   Registered the `/ai_settings` and `/ai_usage` API routers.
    *   Modified the `/api/v1/ai_eval` (POST) endpoint:
        *   Now an `async` function.
        *   Fetches prompts from the database (via `ctx.store`) with fallback to environment variables/defaults.
        *   Replaces `{{CGMDATA}}` token in the user prompt.
        *   Uses `req.settings.ai_llm_model` for the LLM payload.
        *   If `req.settings.ai_llm_debug` is true, includes `debug_prompts` in the JSON response to the client.
        *   After a successful LLM call, extracts `total_tokens` from the LLM response and calls `POST /api/v1/ai_usage/record` to save usage.
        *   Uses `ctx.authorization.isPermitted('api:treatments:read')` for authorization of the main evaluation.

### 2. Database Changes

*   **`ai_prompt_settings` collection:**
    *   Stores AI prompt configurations.
    *   Typically a single document with `_id: "main_config"` containing:
        *   `system_prompt` (String)
        *   `user_prompt_template` (String)
        *   `updated_at` (Date)
    *   `upsert: true` is used for creation/update.
*   **`ai_usage_stats` collection:** (New)
    *   Stores monthly AI token usage statistics.
    *   Documents use `_id` format: `"YYYY-MM"` (e.g., `"2023-10"`).
    *   Each document contains:
        *   `total_tokens_month` (Number): Total tokens consumed in that month.
        *   `api_calls_month` (Number): Total successful API calls to LLM in that month.
        *   `daily_usage_array` (Array): Array of objects, each representing a day:
            *   `date` (String): Date string like `"YYYY-MM-DD"`.
            *   `total_tokens_day` (Number): Tokens consumed on this specific day.
            *   `api_calls_day` (Number): API calls made on this specific day.
        *   `last_updated` (Date): Timestamp of the last update to this monthly record.
    *   `upsert: true` is used for creation/update.


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
*   **AI Usage Tracking:**
    *   `POST /api/v1/ai_usage/record`
        *   **Request Body:** `{ tokens_used: Number }`
        *   **Authorization:** Currently uses `api:treatments:create` (placeholder, ideally a more specific permission like `api:ai_usage:record` or system-level access if only called internally).
        *   **Functionality:** Records the number of tokens used for an AI evaluation. Updates monthly and daily aggregates in the `ai_usage_stats` collection. Called by `/api/v1/ai_eval` internally.
    *   `GET /api/v1/ai_usage/monthly_summary`
        *   **Authorization:** Currently uses `api:treatments:read` (placeholder, ideally `api:ai_usage:read` or admin-level).
        *   **Functionality:** Returns all documents from the `ai_usage_stats` collection, providing a summary of token usage per month.

### 4. Data Flow for AI Evaluation

1.  **User loads data in a standard Nightscout report.** This action (e.g., clicking "Show" on the "Day to day" report) makes `datastorage`, `sorteddaystoshow`, and `options` available to plugins.
2.  **User navigates to the "AI Evaluation" tab.**
    a.  The `script` in `lib/report_plugins/ai_eval.js` immediately performs a comprehensive settings check:
        i.  Verifies client-side settings (`ai_llm_api_url`, `ai_llm_model`).
        ii. Fetches server-side prompts (`system_prompt`, `user_prompt_template`) via `GET /api/v1/ai_settings/prompts`.
    b.  The UI in `#ai-eval-status-area` is updated with either a success message or a list of missing configurations.
3.  **Main report data triggers AI evaluation (if settings are valid):**
    a.  The `report(datastorage, sorteddaystoshow, options)` function in `ai_eval.js` is called by Nightscout's report client when data is ready.
    b.  This function stores the data and then re-runs the settings check logic (or uses its current state).
    c.  If settings are valid and data is present:
        i.  A `cgmDataPayload` object is constructed. This object contains:
            *   `reportSettings`: Target glucose range, units, date range, report name.
            *   `entries`: Array of SGV, MBG data points with timestamps.
            *   `treatments`: Array of treatment data (insulin, carbs, notes, timestamps, etc.).
            *   `profile`: Current active profile data (timezone, basal rates, ISF, carb ratios) obtained via `client.profile()`.
            *   `deviceStatus`: Array of device status entries (if available in the loaded report data).
        ii. `client.triggerAIEvaluation(cgmDataPayload)` is called.
4.  **Client-side AJAX request:**
    a.  `client.triggerAIEvaluation` sets the UI to a "Loading AI evaluation..." state.
    b.  It sends the `cgmDataPayload` as a JSON body in a `POST` request to `/api/v1/ai_eval`.
5.  **Server-side `/api/v1/ai_eval` endpoint:**
    a.  Retrieves `AI_LLM_KEY`, `AI_LLM_API_URL`, `AI_LLM_MODEL`, `AI_LLM_DEBUG` from `req.settings`.
    b.  Fetches `system_prompt` and `user_prompt_template` from the `ai_prompt_settings` MongoDB collection (or uses fallbacks if not found in DB but present in environment variables).
    c.  The received `cgmDataPayload` (from the request body) is stringified and injected into the `{{CGMDATA}}` token of the `user_prompt_template`.
    d.  Constructs the final LLM payload (model, system message, final user message with injected data).
    e.  Makes a POST request to the configured `AI_LLM_API_URL` with the LLM payload and `AI_LLM_KEY`.
    f.  Receives the LLM's response.
    g.  If the LLM call is successful and token information (e.g., `response.data.usage.total_tokens` for OpenAI) is available, it makes an internal POST request to `/api/v1/ai_usage/record` with the `total_tokens`.
    h.  Constructs a JSON response for the client. This response includes:
        *   `html_content`: The LLM's answer.
        *   `tokens_used`: The number of tokens consumed for this specific request.
        *   `debug_info` (if `AI_LLM_DEBUG` is true): An object containing `model`, `system_prompt`, and `final_user_prompt`.
6.  **Client-side script in `ai_eval.js` receives the response:**
    a.  Displays the `html_content` in `#ai-eval-results`.
    b.  Displays the `tokens_used` information (e.g., in `#ai-eval-status-area` or near results).
    c.  If `AI_LLM_DEBUG` is true and `debug_info` is present, it's formatted and displayed in `#ai-eval-debug-info`.
    d.  Handles and displays any errors received from the server.

### 5. Permissions

*   **AI Evaluation (`POST /api/v1/ai_eval`):** Requires `api:treatments:read` (or similar report viewing permission).
*   **Prompt Settings (`GET /api/v1/ai_settings/prompts`):** Requires `api:treatments:read`.
*   **Prompt Settings (`POST /api/v1/ai_settings/prompts`):** Requires `admin:api:ai_settings:edit`. This permission string might need to be explicitly added to custom admin roles.
*   **Usage Recording (`POST /api/v1/ai_usage/record`):** Called internally by `/ai_eval`. Currently uses `api:treatments:create` as a placeholder. For enhanced security, a dedicated system-level permission or internal authentication mechanism would be ideal if this endpoint were exposed more broadly.
*   **Usage Summary (`GET /api/v1/ai_usage/monthly_summary`):** Currently uses `api:treatments:read`. Ideally, this would be a more specific `api:ai_usage:read` or an admin-level permission.

---
This markdown file should provide a comprehensive overview for both users and developers.
Please let me know if you'd like any sections expanded or clarified!
