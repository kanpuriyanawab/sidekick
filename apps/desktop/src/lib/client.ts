import { createHostClient } from "./hostClient";
import { createMockClient } from "./mockClient";

export const createClient = () => {
  const mockFlag = import.meta.env.VITE_SIDEKICK_MOCK;
  const useMock = mockFlag === "true" || mockFlag === "1";
  return useMock ? createMockClient() : createHostClient();
};
