import {
  Watcher,
  ComputedGetter,
  ComputedSetter,
} from 'yox-type/src/type'

import {
  WatcherOptions,
} from 'yox-type/src/options'

import Observer from './Observer'

import * as object from 'yox-common/src/util/object'

/**
 * 计算属性
 *
 * 可配置 cache、deps、get、set 等
 */
export default class Computed {

  static current?: Computed

  keypath: string

  value: any

  cache: boolean

  staticDeps: string[] | void

  dynamicDeps: Record<number, Record<string, Observer>> | void

  setter: ComputedSetter | void

  getter: ComputedGetter

  execute: () => any

  watcher: Watcher

  watcherOptions: WatcherOptions

  constructor(
    observer: Observer,
    keypath: string,
    sync: boolean,
    cache: boolean,
    deps: string[] | void,
    args: any[] | void,
    getter: ComputedGetter,
    setter: ComputedSetter | void
  ) {

    const instance = this

    instance.keypath = keypath
    instance.cache = cache

    instance.setter = setter
    instance.getter = getter

    instance.execute = args
      ? function () {
          return getter.apply(this, args)
        }
      : getter

    instance.watcherOptions = {
      sync,
      watcher: instance.watcher = function ($0: any, $1: any, $2: string) {

        // 计算属性的依赖变了会走进这里

        const oldValue = instance.value

        // 清除缓存
        delete instance.value

        const newValue = instance.get()

        if (newValue !== oldValue) {
          observer.diff(keypath, newValue, oldValue)
        }

      }
    }

    // 如果 deps 是空数组，Observer 会传入 undefined
    // 因此这里直接判断即可
    if (deps) {
      instance.staticDeps = deps
      for (let i = 0, length = deps.length; i < length; i++) {
        observer.watch(
          deps[i],
          instance.watcherOptions
        )
      }
    }

  }

  /**
   * 读取计算属性的值
   */
  get(): any {

    const instance = this,

    { execute, dynamicDeps, watcher } = instance

    // 禁用缓存
    if (!instance.cache) {
      instance.value = execute()
    }

    // 减少取值频率，尤其是处理复杂的计算规则
    else if (!object.has(instance, 'value')) {

      // 如果写死了依赖，则不需要收集依赖
      if (instance.staticDeps) {
        instance.value = execute()
      }
      // 自动收集依赖
      else {

        // 清空上次收集的依赖
        if (dynamicDeps) {
          for (let id in dynamicDeps) {
            const deps = dynamicDeps[id]
            for (let keypath in deps) {
              deps[keypath].unwatch(keypath, watcher)
            }
          }
        }

        // 惰性初始化
        instance.dynamicDeps = { }

        const lastComputed = Computed.current

        // 开始收集新的依赖
        Computed.current = instance
        instance.value = execute()
        // 取值完成，恢复原值
        Computed.current = lastComputed

      }

    }

    return instance.value
  }

  set(value: any) {
    const { setter } = this
    if (setter) {
      setter(value)
    }
  }

  /**
   * 添加依赖
   *
   * @param dep
   */
  addDep(observer: Observer, dep: string) {
    const { dynamicDeps, watcherOptions } = this,
    deps = dynamicDeps[observer.id] || (dynamicDeps[observer.id] = { })
    if (!deps[dep]) {
      observer.watch(
        dep,
        watcherOptions
      )
      deps[dep] = observer
    }
  }

}