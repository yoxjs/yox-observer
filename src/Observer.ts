import {
  data,
  getter,
  watcher,
  ValueHolder,
  EmitterOptions,
  ObserverInterface,
} from '../../yox-type/src/type'

import {
  WatcherOptions,
  ComputedOptions,
} from '../../yox-type/src/global'

import * as is from '../../yox-common/src/util/is'
import * as env from '../../yox-common/src/util/env'
import * as array from '../../yox-common/src/util/array'
import * as object from '../../yox-common/src/util/object'
import * as string from '../../yox-common/src/util/string'

import toNumber from '../../yox-common/src/function/toNumber'
import execute from '../../yox-common/src/function/execute'
import Emitter from '../../yox-common/src/util/Emitter'
import NextTask from '../../yox-common/src/util/NextTask'

import Computed from './Computed'
import matchBest from './function/matchBest'
import diffWatcher from './function/diffWatcher'
import filterWatcher from './function/filterWatcher'
import formatWatcherOptions from './function/formatWatcherOptions'

interface AsyncChange {

  // 旧值
  value: any

  // 监听的 keypath
  keypaths: string[]

}

/**
 * 观察者有两种观察模式：
 *
 * 1. 同步监听
 * 2. 异步监听
 *
 * 对于`计算属性`这种需要实时变化的对象，即它的依赖变了，它需要立即跟着变，否则会出现不一致的问题
 * 这种属于同步监听
 *
 * 对于外部调用 observer.watch('keypath', listener)，属于异步监听，它只关心是否变了，而不关心是否是立即触发的
 */
export default class Observer implements ObserverInterface {

  data: data

  context: any

  nextTask: NextTask

  computed?: Record<string, Computed>

  reversedComputedKeys?: string[]

  syncEmitter: Emitter

  asyncEmitter: Emitter

  asyncChanges: Record<string, AsyncChange>

  pending?: boolean

  constructor(data?: data, context?: any) {

    const instance = this

    instance.data = data || {}
    instance.context = context || instance
    instance.nextTask = new NextTask()

    instance.syncEmitter = new Emitter()
    instance.asyncEmitter = new Emitter()
    instance.asyncChanges = {}

  }

  /**
   * 获取数据
   *
   * @param keypath
   * @param defaultValue
   * @param depIgnore
   * @return
   */
  get(
    keypath: string,
    defaultValue?: any,
    depIgnore?: boolean
  ): any {

    const instance = this,

    currentComputed = Computed.current,

    { data, computed, reversedComputedKeys } = instance

    // 传入 '' 获取整个 data
    if (keypath === env.EMPTY_STRING) {
      return data
    }

    // 调用 get 时，外面想要获取依赖必须设置是谁在收集依赖
    // 如果没设置，则跳过依赖收集
    if (currentComputed && !depIgnore) {
      currentComputed.add(keypath)
    }

    let result: ValueHolder | void, target: Computed | void

    if (computed) {
      target = computed[keypath]
      if (target) {
        return target.get()
      }
      if (reversedComputedKeys) {
        const match = matchBest(reversedComputedKeys, keypath)
        if (match && match.prop) {
          result = object.get(
            computed[match.name].get(),
            match.prop
          )
        }
      }
    }

    if (!result) {
      result = object.get(data, keypath)
    }

    return result ? result.value : defaultValue

  }

  /**
   * 更新数据
   *
   * @param keypath
   * @param value
   */
  set(
    keypath: string | data,
    value?: any
  ) {

    const instance = this,

    { data, computed, reversedComputedKeys } = instance,

    setValue = function (newValue: any, keypath: string) {

      const oldValue = instance.get(keypath)
      if (newValue === oldValue) {
        return
      }

      let target: Computed | void

      if (computed) {
        target = computed[keypath]
        if (target) {
          target.set(newValue)
        }
        if (reversedComputedKeys) {
          const match = matchBest(reversedComputedKeys, keypath)
          if (match && match.prop) {
            target = computed[match.name]
            if (target) {
              const targetValue = target.get()
              if (is.object(targetValue)) {
                object.set(targetValue, match.prop, newValue)
              }
            }
          }
        }
      }

      if (!target) {
        object.set(data, keypath, newValue)
      }

      instance.diff(keypath, newValue, oldValue)

    }

    if (is.string(keypath)) {
      setValue(value, keypath as string)
    }
    else if (is.object(keypath)) {
      object.each(keypath as data, setValue)
    }

  }

  /**
   * 同步调用的 diff，用于触发 syncEmitter，以及唤醒 asyncEmitter
   *
   * @param keypath
   * @param newValue
   * @param oldValue
   */
  diff(
    keypath: string,
    newValue: any,
    oldValue: any
  ): void {

    const instance = this,

    { syncEmitter, asyncEmitter, asyncChanges } = instance,

    /**
     * 我们认为 $ 开头的变量是不可递归的
     * 比如浏览器中常见的 $0 表示当前选中元素
     * DOM 元素是不能递归的
     */
    isRecursive = string.codeAt(keypath) !== 36

    diffWatcher(
      keypath, newValue, oldValue,
      syncEmitter.listeners, isRecursive,
      function (watchKeypath: string, keypath: string, newValue: any, oldValue: any) {
        syncEmitter.fire(watchKeypath, [newValue, oldValue, keypath])
      }
    )

    /**
     * 此处有坑，举个例子
     *
     * observer.watch('a', function () {})
     *
     * observer.set('a', 1)
     *
     * observer.watch('a', function () {})
     *
     * 这里，第一个 watcher 应该触发，但第二个不应该，因为它绑定监听时，值已经是最新的了
     */

    diffWatcher(
      keypath, newValue, oldValue,
      asyncEmitter.listeners, isRecursive,
      function (watchKeypath: string, keypath: string, newValue: any, oldValue: any) {

        array.each(
          asyncEmitter.listeners[watchKeypath],
          function (item: EmitterOptions) {
            (item.count as number)++
          }
        )

        const { keypaths } = asyncChanges[keypath] || (asyncChanges[keypath] = { value: oldValue, keypaths: [] })
        if (!array.has(keypaths, watchKeypath)) {
          array.push(keypaths, watchKeypath)
        }

        if (!instance.pending) {
          instance.pending = env.TRUE
          instance.nextTask.append(
            function () {
              if (instance.pending) {
                instance.pending = env.UNDEFINED
                instance.diffAsync()
              }
            }
          )
        }
      }
    )

  }

  /**
   * 异步触发的 diff
   */
  diffAsync(): void {

    const instance = this,

    { asyncEmitter, asyncChanges } = instance

    instance.asyncChanges = {}

    object.each(
      asyncChanges,
      function (change: AsyncChange, keypath: string) {

        const args = [instance.get(keypath), change.value, keypath]

        // 不能在这判断新旧值是否相同，相同就不 fire
        // 因为前面标记了 count，在这中断会导致 count 无法清除

        array.each(
          change.keypaths,
          function (watchKeypath: string) {
            asyncEmitter.fire(watchKeypath, args, filterWatcher)
          }
        )

      }
    )

  }

  /**
   * 添加计算属性
   *
   * @param keypath
   * @param computed
   */
  addComputed(
    keypath: string,
    options: getter | ComputedOptions
  ): Computed | void {

    const instance = this,

    computed = Computed.build(keypath, instance, options)

    if (computed) {

      if (!instance.computed) {
        instance.computed = {}
      }

      instance.computed[keypath] = computed
      instance.reversedComputedKeys = object.sort(instance.computed, env.TRUE)

      return computed

    }

  }

  /**
   * 移除计算属性
   *
   * @param keypath
   */
  removeComputed(
    keypath: string
  ): void {

    const instance = this,

    { computed } = instance

    if (computed && object.has(computed, keypath)) {
      delete computed[keypath]
      instance.reversedComputedKeys = object.sort(computed, env.TRUE)
    }

  }

  /**
   * 监听数据变化
   *
   * @param keypath
   * @param watcher
   * @param immediate
   */
  watch(
    keypath: string | Record<string, watcher | WatcherOptions>,
    watcher?: watcher | WatcherOptions,
    immediate?: boolean
  ) {

    const instance = this,

    { context, syncEmitter, asyncEmitter } = instance,

    bind = function (keypath: string, options: WatcherOptions) {

      const emitter = options.sync ? syncEmitter : asyncEmitter,

      // formatWatcherOptions 保证了 options.watcher 一定存在
      listener: EmitterOptions = {
        fn: options.watcher,
        ctx: context,
        count: 0,
      }

      if (options.once) {
        listener.max = 1
      }

      emitter.on(keypath, listener)

      if (options.immediate) {
        execute(
          options.watcher,
          context,
          [
            instance.get(keypath),
            env.UNDEFINED,
            keypath
          ]
        )
      }

    }

    if (is.string(keypath)) {
      bind(
        keypath as string,
        formatWatcherOptions(watcher, immediate) as WatcherOptions
      )
      return
    }

    object.each(
      keypath as data,
      function (options: watcher | WatcherOptions, keypath: string) {
        bind(keypath, formatWatcherOptions(options) as WatcherOptions)
      }
    )

  }

  /**
   * 取消监听数据变化
   *
   * @param keypath
   * @param watcher
   */
  unwatch(
    keypath?: string,
    watcher?: watcher
  ) {
    this.syncEmitter.off(keypath, watcher)
    this.asyncEmitter.off(keypath, watcher)
  }

  /**
   * 取反 keypath 对应的数据
   *
   * 不管 keypath 对应的数据是什么类型，操作后都是布尔型
   *
   * @param keypath
   * @return 取反后的布尔值
   */
  toggle(keypath: string): boolean {
    const value = !this.get(keypath)
    this.set(keypath, value)
    return value
  }

  /**
   * 递增 keypath 对应的数据
   *
   * 注意，最好是整型的加法，如果涉及浮点型，不保证计算正确
   *
   * @param keypath 值必须能转型成数字，如果不能，则默认从 0 开始递增
   * @param step 步进值，默认是 1
   * @param max 可以递增到的最大值，默认不限制
   */
  increase(keypath: string, step?: number, max?: number): number | void {
    const value = toNumber(this.get(keypath), 0) + (step || 1)
    if (!is.number(max) || value <= (max as number)) {
      this.set(keypath, value)
      return value
    }
  }

  /**
   * 递减 keypath 对应的数据
   *
   * 注意，最好是整型的减法，如果涉及浮点型，不保证计算正确
   *
   * @param keypath 值必须能转型成数字，如果不能，则默认从 0 开始递减
   * @param step 步进值，默认是 1
   * @param min 可以递减到的最小值，默认不限制
   */
  decrease(keypath: string, step?: number, min?: number): number | void {
    const value = toNumber(this.get(keypath), 0) - (step || 1)
    if (!is.number(min) || value >= (min as number)) {
      this.set(keypath, value)
      return value
    }
  }

  /**
   * 在数组指定位置插入元素
   *
   * @param keypath
   * @param item
   * @param index
   */
  insert(keypath: string, item: any, index: number | boolean): true | void {

    let list = this.get(keypath)
    list = !is.array(list) ? [] : object.copy(list)

    const { length } = list
    if (index === env.TRUE || index === length) {
      list.push(item)
    }
    else if (index === env.FALSE || index === 0) {
      list.unshift(item)
    }
    else if (index > 0 && index < length) {
      list.splice(index, 0, item)
    }
    else {
      return
    }

    this.set(keypath, list)

    return env.TRUE

  }

  /**
   * 在数组尾部添加元素
   *
   * @param keypath
   * @param item
   */
  append(keypath: string, item: any): true | void {
    return this.insert(keypath, item, env.TRUE)
  }

  /**
   * 在数组首部添加元素
   *
   * @param keypath
   * @param item
   */
  prepend(keypath: string, item: any): true | void {
    return this.insert(keypath, item, env.FALSE)
  }

  /**
   * 通过索引移除数组中的元素
   *
   * @param keypath
   * @param index
   */
  removeAt(keypath: string, index: number): true | void {
    let list = this.get(keypath)
    if (is.array(list)
      && index >= 0
      && index < list.length
    ) {
      list = object.copy(list)
      list.splice(index, 1)
      this.set(keypath, list)
      return env.TRUE
    }
  }

  /**
   * 直接移除数组中的元素
   *
   * @param keypath
   * @param item
   */
  remove(keypath: string, item: any): true | void {
    let list = this.get(keypath)
    if (is.array(list)) {
      list = object.copy(list)
      if (array.remove(list, item)) {
        this.set(keypath, list)
        return env.TRUE
      }
    }
  }

  /**
   * 拷贝任意数据，支持深拷贝
   *
   * @param data
   * @param deep
   */
  copy<T>(data: T, deep?: boolean): T {
    return object.copy(data, deep)
  }

  /**
   * 销毁
   */
  destroy() {
    const instance = this
    instance.syncEmitter.off()
    instance.asyncEmitter.off()
    instance.nextTask.clear()
    object.clear(instance)
  }

}
