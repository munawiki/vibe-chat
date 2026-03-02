import { z } from "zod";
import type { ChatViewModel } from "./viewModel.js";
import { ChatViewModelSchema } from "../contract/protocol/index.js";

type SchemaMatchesChatViewModel =
  ChatViewModel extends z.infer<typeof ChatViewModelSchema> ? true : never;

export const schemaMatchesChatViewModel: SchemaMatchesChatViewModel = true;
