import { z } from "zod";
import type { ChatViewModel } from "./viewModel.js";
import { ChatViewModelSchema } from "../contract/webviewProtocol.js";

type SchemaMatchesChatViewModel =
  ChatViewModel extends z.infer<typeof ChatViewModelSchema> ? true : never;

const schemaMatchesChatViewModel: SchemaMatchesChatViewModel = true;
void schemaMatchesChatViewModel;
