import type { AvatarModelReference } from '@proj-airi/core-character'

import type { Live2DParameterMapping } from '../controls/parameter-mapping'

/**
 * Stores the controls that a Live2D Avatar Model does not expose.
 *
 * `parameterMapping` and `skipMouthOpen` travel with the character card.
 * A channel missing from `parameterMapping` is resolved from the model.
 */
export interface Live2DControlPolicy {
  /** Exact expression names that the runtime rejects. */
  disabledExpressions: string[]
  /** Exact motion file names that the runtime rejects. */
  disabledMotions: string[]
  /** Authoritative bindings shipped or edited for this avatar model. */
  parameterMapping?: Live2DParameterMapping
  /**
   * When true, MAGIC motion clears mouth opening.
   * When false, MAGIC motion writes mouth opening.
   * When omitted, a mapped mouth is driven and other models use the global setting.
   */
  skipMouthOpen?: boolean
}

/** Character-owned configuration for one Live2D avatar-model reference. */
export interface Live2DAvatarModelConfig {
  /** Selects the expressions and motions that the Agent can use. */
  controls: Live2DControlPolicy
}

/** References one Live2D display model from a character definition. */
export type Live2DAvatarModelReference = AvatarModelReference<'live2d', Live2DAvatarModelConfig>
