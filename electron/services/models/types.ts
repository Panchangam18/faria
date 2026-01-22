import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * Configuration for creating a model
 */
export interface ModelConfig {
  model: string;
  maxTokens: number;
}

/**
 * Screen dimensions for computer use
 */
export interface ScreenDimensions {
  width: number;
  height: number;
}

/**
 * Result of creating a model with tools bound
 */
export interface BoundModel {
  /** The model with tools bound - using any to avoid complex generic type issues */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  /** Options to pass when invoking the model */
  invokeOptions: Record<string, unknown>;
  /** The name of the computer tool for this provider */
  computerToolName: string;
}

/**
 * Model provider interface
 */
export interface ModelProvider {
  /** Provider name */
  name: string;

  /** Check if this provider handles the given model */
  supportsModel(modelName: string): boolean;

  /** Create a base model instance */
  createModel(config: ModelConfig): BaseChatModel | null;

  /** Create a model with computer use and other tools bound */
  createModelWithTools(
    config: ModelConfig,
    tools: DynamicStructuredTool[],
    screenDimensions: ScreenDimensions
  ): BoundModel | null;

  /** Get invoke options for this provider */
  getInvokeOptions(): Record<string, unknown>;
}

