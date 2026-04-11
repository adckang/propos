import ReactDOM from "react-dom/client";

import PROPOS_CONFIG from "./config/propos.config.json";
import App from "./components/App";
import "./styles/main.css";
import "./utils/toast";

window.PROPOS_CONFIG = PROPOS_CONFIG;

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
