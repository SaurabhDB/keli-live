import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/provider";
import { loadConfig } from "./lib/api";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

loadConfig()
  .then((cfg) =>
    root.render(
      <StrictMode>
        <I18nProvider>
          <App cfg={cfg} />
        </I18nProvider>
      </StrictMode>,
    ),
  )
  .catch((err: unknown) => root.render(<p className="fatal">Could not load config.json: {String(err)}</p>));
