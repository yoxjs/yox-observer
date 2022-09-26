import {
  Watcher,
  ComputedGetter,
  ComputedSetter,
} from 'yox-type/src/type'

import {
  WatcherOptions,
} from 'yox-type/src/options'

import Observer from './Observer'

import * as is from 'yox-common/src/util/is'
import * as object from 'yox-common/src/util/object'
import * as constant from 'yox-common/src/util/constant'

function runGetter(instance: Computed) {
  const { args, getter } = instance
  instance.value = args
    ? getter.apply(constant.UNDEFINED, args)
    : getter()
}

function runOutter(instance: Computed) {
  const { value, outter } = instance
  return outter
    ? outter(value)
    : value
}

/**
 * 计算属性
 *
 * 可配置 cache、deps、args, get、set 等
 */
export default class Computed {

  static current?: Computed

  observer: Observer

  keypath: string

  value: any

  cache: boolean

  args: any[] | void

  staticDeps: string[] | void

  dynamicDeps: Record<number, Record<string, Observer>> | void

  outter: ComputedSetter | void

  setter: ComputedSetter | void

  getter: ComputedGetter

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
    setter: ComputedSetter | void,
    outter: ComputedSetter | void
  ) {

    const instance = this

    instance.observer = observer
    instance.keypath = keypath
    instance.cache = cache
    instance.args = args

    instance.outter = outter
    instance.setter = setter
    instance.getter = getter

    instance.watcherOptions = {
      sync,
      watcher: instance.watcher = function ($0: any, $1: any, $2: string) {
        // 计算属性的依赖变了会走进这里
        instance.refresh()
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

    { dynamicDeps, watcher } = instance

    // 禁用缓存
    if (!instance.cache) {
      runGetter(instance)
    }

    // 减少取值频率，尤其是处理复杂的计算规则
    else if (!object.has(instance, 'value')) {

      // 如果写死了依赖，则不需要收集依赖
      if (instance.staticDeps) {
        runGetter(instance)
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
        runGetter(instance)
        // 取值完成，恢复原值
        Computed.current = lastComputed

      }

    }

    return runOutter(instance)
  }

  set(value: any) {
    const { setter } = this
    if (setter) {
      setter(value)
    }
    else if (is.func(value)) {
      this.getter = value
      this.refresh()
    }
  }

  refresh() {

    const { observer, keypath, value } = this

    // 清除缓存
    delete this.value

    const newValue = this.get()

    if (newValue !== value) {
      observer.diff(keypath, newValue, value)
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