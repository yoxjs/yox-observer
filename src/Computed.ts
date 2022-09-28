import {
  Watcher,
  ComputedGetter,
  ComputedSetter,
  ComputedOutput,
} from 'yox-type/src/type'

import {
  WatcherOptions,
} from 'yox-type/src/options'

import Observer from './Observer'

import * as is from 'yox-common/src/util/is'
import * as constant from 'yox-common/src/util/constant'

const STATUS_INIT = 1
const STATUS_FRESH = 2
const STATUS_DIRTY = 3

function runGetter(instance: Computed) {
  const { input, getter } = instance
  instance.value = input
    ? getter.apply(constant.UNDEFINED, input)
    : getter()
}

function runOutput(instance: Computed) {
  const { value, output } = instance
  return output
    ? output(value)
    : value
}

class Deps {

  map: Record<number, Record<string, Observer>>
  list: [Observer, string][]

  constructor() {
    this.map = { }
    this.list = [ ]
  }

  add(observer: Observer, dep: string) {
    const deps = this.map[observer.id] || (this.map[observer.id] = { })
    if (!deps[dep]) {
      deps[dep] = observer
      this.list.push([
        observer, dep
      ])
    }
  }

  watch(watcher: WatcherOptions) {
    const { list } = this
    if (list) {
      for (let i = 0, length = list.length; i < length; i++) {
        list[i][0].watch(list[i][1], watcher)
      }
    }
  }

  unwatch(watcher: Watcher) {
    const { list } = this
    if (list) {
      for (let i = 0, length = list.length; i < length; i++) {
        list[i][0].unwatch(list[i][1], watcher)
      }
    }
  }

}

/**
 * 计算属性
 *
 * 可配置 cache、deps, get、set 等
 */
export default class Computed {

  static current?: Computed

  keypath: string

  value: any

  status: number

  cache: boolean

  input: any[] | void

  output: ComputedOutput | void

  setter: ComputedSetter | void

  getter: ComputedGetter

  staticDeps: Deps | void

  dynamicDeps: Deps | void

  watcherOptions: WatcherOptions

  onChange: (keypath: string, newValue: any, oldValue: any) => void

  constructor(
    keypath: string,
    cache: boolean,
    sync: boolean,
    input: any[] | void,
    output: ComputedOutput | void,
    getter: ComputedGetter,
    setter: ComputedSetter | void,
    onChange: (keypath: string, newValue: any, oldValue: any) => void
  ) {

    const instance = this

    instance.status = STATUS_INIT

    instance.keypath = keypath
    instance.cache = cache
    instance.input = input
    instance.output = output
    instance.setter = setter
    instance.getter = getter

    instance.onChange = onChange

    instance.watcherOptions = {
      sync,
      watcher() {
        instance.refresh()
      }
    }

  }

  /**
   * 读取计算属性的值
   */
  get(): any {

    const instance = this,

    { status, watcherOptions } = instance

    // 禁用缓存
    if (!instance.cache) {
      runGetter(instance)
    }

    // 减少取值频率，尤其是处理复杂的计算规则
    else if (status !== STATUS_FRESH) {

      // 如果写死了依赖，则不需要收集依赖
      if (instance.staticDeps) {
        runGetter(instance)
      }
      // 自动收集依赖
      else {

        let { dynamicDeps } = instance

        // 清空上次收集的依赖
        if (dynamicDeps) {
          dynamicDeps.unwatch(watcherOptions.watcher)
        }

        instance.dynamicDeps = constant.UNDEFINED

        const lastComputed = Computed.current

        // 开始收集新的依赖
        Computed.current = instance
        runGetter(instance)
        // 取值完成，恢复原值
        Computed.current = lastComputed

        dynamicDeps = instance.dynamicDeps as Deps | void
        if (dynamicDeps) {
          dynamicDeps.watch(watcherOptions)
        }

      }

    }

    if (status !== STATUS_FRESH) {
      instance.status = STATUS_FRESH
    }

    return runOutput(instance)
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

    const oldValue = this.value

    this.status = STATUS_DIRTY

    const newValue = this.get()

    if (newValue !== oldValue) {
      this.onChange(this.keypath, newValue, oldValue)
    }

  }

  addStaticDeps(observer: Observer, deps: string[]) {

    const staticDeps = this.staticDeps || (this.staticDeps = new Deps())

    for (let i = 0, length = deps.length; i < length; i++) {
      staticDeps.add(observer, deps[i])
    }

    staticDeps.watch(this.watcherOptions)

  }

  addDynamicDep(observer: Observer, dep: string) {

    // 动态依赖不能在这直接 watch
    // 只有当计算属性的依赖全部收集完了，才能监听该计算属性的所有依赖
    // 这样可保证依赖最少的计算属性最先执行 watch，当依赖变化时，它也会最早触发 refresh
    const deps = this.dynamicDeps || (this.dynamicDeps = new Deps())
    deps.add(observer, dep)

  }

}

