import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import "../src/features/access/workspace.css";
import "../src/styles.css";
import "@veca/ui/src/select.css";
import "@veca/ui/src/article.css";
import "../src/features/operations/operations.css";
import "../src/features/accounting/accounting.css";
import "../src/features/warehouse/warehouse.css";
import "../src/theme/theme.css";
import "./stories/previews.css";
import { handlers } from "./stories/fixtures";
const preview: Preview = {
  loaders: [mswLoader()],
  parameters: { layout: "fullscreen", msw: handlers },
};
export default preview;
