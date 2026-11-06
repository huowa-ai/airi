import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { emptyLive2DParameterCatalog } from '../controls/parameter-mapping'
import { catalogAfterBroadcast, useLive2DParameterRig } from './parameter-rig'

const stageCatalog = {
  parameterIds: ['ParamAngleX', 'AngleX', 'HipAngleX'],
  physicsInputIds: ['AngleX', 'HipAngleX'],
  physicsGroups: [['AngleX'], ['ParamBodyAngleX', 'HipAngleX']],
}

describe('live2d catalog broadcast', () => {
  it('gives an empty window the stage catalog and keeps a loaded catalog', () => {
    expect(catalogAfterBroadcast({
      hasLocalCatalog: false,
      modelId: '',
      catalog: emptyLive2DParameterCatalog,
    }, { type: 'catalog', modelId: 'model-1', catalog: stageCatalog })).toMatchObject({
      catalog: stageCatalog,
      modelId: 'model-1',
    })

    expect(catalogAfterBroadcast({
      hasLocalCatalog: true,
      modelId: 'preview',
      catalog: stageCatalog,
    }, { type: 'catalog', modelId: 'other', catalog: { parameterIds: ['ParamAngleY'], physicsInputIds: [] } })).toBeUndefined()

    expect(catalogAfterBroadcast({
      hasLocalCatalog: true,
      modelId: 'model-1',
      catalog: stageCatalog,
    }, { type: 'request' })).toBe('reply')
  })

  it('delivers a published catalog to a second window', async () => {
    const stagePinia = createPinia()
    const settingsPinia = createPinia()
    setActivePinia(settingsPinia)
    const settings = useLive2DParameterRig()
    setActivePinia(stagePinia)
    const stage = useLive2DParameterRig()

    stage.publishCatalog(stageCatalog, 'model-1')

    await vi.waitFor(() => {
      expect(settings.catalog.parameterIds).toEqual(stageCatalog.parameterIds)
    })
    expect(settings.modelId).toBe('model-1')
  })
})
