import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as nextTask from 'yox-common/util/nextTask'

import toNumber from 'yox-common/function/toNumber'
import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'

import Computed from './Computed'
import matchBest from './function/matchBest'
import diffWatcher from './function/diffWatcher'

const WATCH_CONFIG_IMMEDIATE = 'immediate'
const WATCH_CONFIG_SYNC = 'sync'
const WATCH_CONFIG_ONCE = 'once'

const watchConfigList = [WATCH_CONFIG_IMMEDIATE, WATCH_CONFIG_SYNC, WATCH_CONFIG_ONCE]

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
export default class Observer {

  context: any

  syncEmitter = new Emitter()

  asyncEmitter = new Emitter()

  asyncChanges = { }

  computed: any

  reversedComputedKeys?: string[]

  pendding: boolean | void

  constructor(context?: any, computed?: Object, public data = {}) {

    const instance = this

    instance.context = context || instance

    if (computed) {
      object.each(
        computed,
        function (item, keypath) {
          instance.addComputed(keypath, item)
        }
      )
    }

  }

  /**
   * 获取数据
   *
   * @param keypath
   * @param defaultValue
   * @return
   */
  get(keypath: string, defaultValue?: any): any {

    const instance = this

    // 传入 '' 获取整个 data
    if (keypath === char.CHAR_BLANK) {
      return instance.data
    }

    // 调用 get 时，外面想要获取依赖必须设置是谁在收集依赖
    // 如果没设置，则跳过依赖收集
    if (Computed.current) {
      Computed.current.add(keypath)
    }

    let result: any, target: Computed | void

    const { computed, reversedComputedKeys } = instance

    if (computed) {
      target = computed[keypath]
      if (target) {
        return target.get()
      }
    }
    if (reversedComputedKeys) {
      const match = matchBest(reversedComputedKeys, keypath)
      if (match && match.prop) {
        target = computed[match.name].get()
        if (target != env.NULL) {
          result = object.get(target, match.prop)
        }
      }
    }

    if (!result) {
      result = object.get(instance.data, keypath)
    }

    return result ? result.value : defaultValue

  }

  /**
   * 更新数据
   *
   * @param keypath
   * @param value
   */
  set(keypath: any, value: any) {

    const instance = this,

    setValue = function (newValue: any, keypath: string) {

      const oldValue = instance.get(keypath)
      if (newValue === oldValue) {
        return
      }

      let target: Computed | void

      const { computed, reversedComputedKeys } = instance

      if (computed) {
        target = computed[keypath]
        if (target) {
          target.set(newValue)
        }
      }
      if (reversedComputedKeys) {
        const match = matchBest(reversedComputedKeys, keypath)
        if (match && match.prop) {
          target = computed[match.name]
          if (target) {
            const targetValue = target.get()
            if (is.object(targetValue) || is.array(targetValue)) {
              object.set(targetValue, match.prop, newValue)
            }
          }
        }
      }

      if (!target) {
        object.set(instance.data, keypath, newValue)
      }

      instance.diffSync(keypath, newValue, oldValue)

    }

    if (is.string(keypath)) {
      setValue(value, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, setValue)
    }

  }

  /**
   * 同步调用的 diff，用于触发 syncEmitter，以及唤醒 asyncEmitter
   *
   * @param keypath
   * @param newValue
   * @param oldValue
   */
  diffSync(keypath: string, newValue: any, oldValue: any) {

    const instance = this,

    { syncEmitter, asyncEmitter, asyncChanges } = instance,

    /**
     * 我们认为 $ 开头的变量是不可递归的
     * 比如浏览器中常见的 $0 表示当前选中元素
     * DOM 元素是不能递归的
     */
    isRecursive = char.codeAt(keypath) !== 36

    diffWatcher(
      keypath, newValue, oldValue,
      syncEmitter.listeners, isRecursive,
      function (watchKeypath: string) {
        syncEmitter.fire(watchKeypath)
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
      function (watching: string, keypath: string, value: any) {

        array.each(
          asyncEmitter.listeners[watching],
          function (item) {
            item.dirty = env.TRUE
          }
        )

        if (!asyncChanges[keypath]) {
          asyncChanges[keypath] = {
            value,
            watches: []
          }
        }

        let { watches } = asyncChanges[keypath]
        if (!array.has(watches, watching)) {
          array.push(watches, watching)
        }

        if (!instance.pendding) {
          instance.pendding = env.TRUE
          instance.nextTick(
            function () {
              if (instance.pendding) {
                instance.pendding = env.UNDEFINED
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
  diffAsync() {

    const instance = this,

    { asyncEmitter, asyncChanges, context } = instance,

    filter = function (item: any, args: any): boolean | void {
      if (item.dirty) {
        item.dirty = env.NULL
        return args[0] !== args[1]
      }
    }

    instance.asyncChanges = {}

    object.each(
      asyncChanges,
      function (item, keypath) {

        let args = [instance.get(keypath), item.value, keypath]

        array.each(
          item.watches,
          function (watching) {
            asyncEmitter.fire(watching, args, context, filter)
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
  addComputed(keypath: string, options: any): Computed | void {

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
  removeComputed(keypath: string) {

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
   * @param options
   * @param options.immediate 是否立即触发一次
   * @param options.sync 是否同步响应，默认是异步
   * @param options.once 是否监听一次
   */
  watch(keypath: string | Object, watcher?: Function | Object, options?: Object) {

    const instance = this,

    { context, syncEmitter, asyncEmitter } = instance,

    bind = function (keypath: string, watcher: Function, options: Object) {

      const emitter = options[WATCH_CONFIG_SYNC] ? syncEmitter : asyncEmitter

      emitter[options[WATCH_CONFIG_ONCE] ? 'once' : 'on'](keypath, watcher)

      if (options[WATCH_CONFIG_IMMEDIATE]) {
        execute(
          watcher,
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
      bind(<string>keypath, <Function>watcher, options || env.plain)
      return
    }

    const globalOptions = watcher || env.plain

    object.each(
      keypath,
      function (value, keypath) {
        let watcher = value, options: any = object.extend({}, globalOptions)
        if (is.object(value)) {
          watcher = value.watcher
          array.each(
            watchConfigList,
            function (field) {
              if (is.boolean(value[field])) {
                options[field] = value[field]
              }
            }
          )
        }
        bind(keypath, watcher, options)
      }
    )

  }

  /**
   * 取消监听数据变化
   *
   * @param keypath
   * @param watcher
   */
  unwatch(keypath: string | Object, watcher?: Function) {
    const { syncEmitter, asyncEmitter } = this
    if (is.string(keypath)) {
      syncEmitter.off(<string>keypath, watcher)
      asyncEmitter.off(<string>keypath, watcher)
    }
    else if (is.object(keypath)) {
      object.each(
        keypath,
        function (watcher: Function, keypath: string) {
          syncEmitter.off(keypath, watcher)
          asyncEmitter.off(keypath, watcher)
        }
      )
    }
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
    let value = !this.get(keypath)
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
   * @param min 可以递增到的最小值，默认不限制
   */
  increase(keypath: string, step = 1, max?: number): number | void {
    const value = toNumber(this.get(keypath), 0) + step
    if (!is.number(max) || value <= <number>max) {
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
  decrease(keypath: string, step = 1, min?: number): number | void {
    const value = toNumber(this.get(keypath), 0) - step
    if (!is.number(min) || value >= <number>min) {
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
  insert(keypath: string, item: any, index: number | boolean): boolean | void {

    let list = this.get(keypath)
    list = !is.array(list) ? [] : object.copy(list)

    let { length } = list
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
   * 通过索引移除数组中的元素
   *
   * @param keypath
   * @param index
   */
  removeAt(keypath: string, index: number): boolean | void {
    let list = this.get(keypath)
    if (is.array(list)
      && index >= 0
      && index < list[env.RAW_LENGTH]
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
  remove(keypath: string, item: any): boolean | void {
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
   * 新增异步任务
   *
   * @param task
   */
  nextTick(task: Function) {
    const instance = this
    nextTask.append(
      function () {
        // 确保没销毁
        if (instance.data) {
          task()
        }
      }
    )
  }

  nextRun() {
    nextTask.run()
  }

  /**
   * 销毁
   */
  destroy() {
    this.syncEmitter.off()
    this.asyncEmitter.off()
    object.clear(this)
  }

}