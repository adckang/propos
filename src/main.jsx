import ReactDOM from "react-dom/client";

import publicConfig from "./config/publicConfig.js";
import App from "./components/App";
import "./styles/main.css";
import "./utils/toast";

window.PROPOS_PUBLIC_CONFIG = publicConfig;

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
