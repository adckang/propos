import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";

import publicConfig from "./config/publicConfig.js";
import App from "./components/App";
import { initClarity } from "./lib/analytics.js";
import "./styles/main.css";
import "./utils/toast";

window.PROPOS_PUBLIC_CONFIG = publicConfig;

function Root() {
  useEffect(() => {
    initClarity();
  }, []);

  return (
    <>
      <App />
      <Analytics />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
