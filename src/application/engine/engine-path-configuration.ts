export interface EnginePathConfiguration {
  load(): string;
  save(path: string): void;
}
