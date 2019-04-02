import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import toNumber from 'yox-common/function/toNumber'
import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'
import Computed from './Computed';
import isFuzzyKeypath from './function/isFuzzyKeypath';
import matchFuzzyKeypath from './function/matchFuzzyKeypath';
import matchBest from './function/matchBest';
import diffObject from './function/diffObject';
import diffArray from './function/diffArray';
import readValue from './function/readValue';
import diffString from './function/diffString';

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

  computed: any

  reversedComputedKeys?: string[]

  pending: boolean

  constructor(context?: any, computed = env.NULL, public data = {}) {

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

  onChange(oldValue, keypath) {

    let instance = this, changes = string.startsWith(keypath, '$')
      ? (instance.$changes || (instance.$changes = {}))
      : (instance.changes || (instance.changes = {}))

    if (!object.has(changes, keypath)) {
      changes[keypath] = oldValue
    }

    if (!instance.pending) {
      instance.pending = env.TRUE
      instance.nextTick(
        function () {
          if (instance.pending) {

            let { changes, $changes, asyncEmitter } = instance

            instance.pending =
              instance.changes =
              instance.$changes = env.NULL

            let listenerKeys = object.keys(asyncEmitter.listeners)

            let eachChange = function (oldValue, keypath) {
              let newValue = instance.get(keypath)
              if (newValue !== oldValue) {
                let args = [newValue, oldValue, keypath]
                asyncEmitter.fire(keypath, args)
                array.each(
                  listenerKeys,
                  function (key) {
                    if (isFuzzyKeypath(key) && matchFuzzyKeypath(keypath, key)) {
                      asyncEmitter.fire(key, args)
                    }
                  }
                )
              }
            }

            $changes && object.each($changes, eachChange)
            changes && object.each(changes, eachChange)

          }
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

    if (!is.string(keypath) || isFuzzyKeypath(keypath)) {
      return
    }

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

    let result: any

    const { computed, reversedComputedKeys } = instance
    if (computed) {
      let target = computed[keypath]
      if (target) {
        return target.get()
      }
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

    const instance = this

    const { syncEmitter } = instance

    // 设值要触发`同步`监听
    const listenKeypaths = object.keys(syncEmitter.listeners)

    // 三个元素算作一个整体
    // 第一个表示监听的 keypath
    // 第二个表示旧值
    // 第三个表示实际的 keypath
    let changes = []



    let addFuzzyChange = function (fuzzyKeypaths: string[], newValue: any, oldValue: any, keypath: string) {
      if (newValue !== oldValue) {

        // fuzzyKeypaths 全是模糊的 keypath

        array.each(
          fuzzyKeypaths,
          function (fuzzyKeypath) {
            if (matchFuzzyKeypath(keypath, fuzzyKeypath)) {
              changes.push(
                fuzzyKeypath, oldValue, keypath
              )
            }
          }
        )

        // 我们认为 $ 开头的变量是不可递归的
        // 比如浏览器中常见的 $0 表示当前选中元素
        // DOM 元素是不能递归的
        if (char.codeAt(keypath) === 36) {
          return
        }

        let diffCallback = function (newValue: any, oldValue: any, propName: string | number) {
          addFuzzyChange(
            fuzzyKeypaths,
            newValue,
            oldValue,
            keypathUtil.join(keypath, propName)
          )
        }

        // 先 array 再 object
        // 因为 array 也是一种 object

        diffString(newValue, oldValue, diffCallback)
          || diffArray(newValue, oldValue, diffCallback)
          || diffObject(newValue, oldValue, diffCallback)

      }
    }

    let addChange = function (newValue: any, oldValue: any, keypath: string) {

      let fuzzyKeypaths = []

      // 只收集正在监听的 keypath
      array.each(
        listenKeypaths,
        function (listenKeypath) {
          if (isFuzzyKeypath(listenKeypath)) {
            array.push(
              fuzzyKeypaths,
              listenKeypath
            )
          }
          else {
            let listenNewValue: any, listenOldValue: any
            if (listenKeypath === keypath) {
              listenNewValue = newValue
              listenOldValue = oldValue
            }
            else {
              let length = keypathUtil.match(listenKeypath, keypath)
              if (length > 0) {
                let propName = string.slice(listenKeypath, length)
                listenNewValue = readValue(newValue, propName)
                listenOldValue = readValue(oldValue, propName)
              }
            }
            if (listenNewValue !== listenOldValue) {
              changes.push(
                listenKeypath, listenOldValue, listenKeypath
              )
            }
          }
        }
      )

      // 存在模糊匹配的需求
      // 必须对数据进行递归
      // 性能确实会慢一些，但是很好用啊，几乎可以监听所有的数据
      if (fuzzyKeypaths.length) {
        addFuzzyChange(fuzzyKeypaths, newValue, oldValue, keypath)
      }

    }

    let setValue = function (value: any, keypath: string) {

      const oldValue = instance.get(keypath)
      if (value === oldValue) {
        return
      }

      // 在真正设值之前调用，可取到 oldValue
      // 比如 set('user.name', 'musicode')
      // 此时有一个计算属性依赖了 user.name，此时就要更新计算属性的值
      addChange(value, oldValue, keypath)

      const { computed, reversedComputedKeys } = instance
      if (computed) {
        let target = computed[keypath]
        if (target) {
          target.set(value)
          return
        }
        const match = matchBest(reversedComputedKeys, keypath)
        if (match && match.prop) {
          target = computed[match.name].get()
          // 如果 target 是基本类型，则忽略此次设值
          if (!is.primitive(target)) {
            object.set(target, match.prop, value)
          }
          return
        }
      }
      object.set(instance.data, keypath, value)

    }

    if (is.string(keypath)) {
      setValue(value, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, setValue)
    }

    for (let i = 0; i < changes[env.RAW_LENGTH]; i += 3) {
      emitter.fire(
        changes[i],
        [
          changes[i + 1],
          changes[i + 2]
        ]
      )
    }

  }

  /**
   * 添加计算属性
   *
   * @param keypath
   * @param computed
   */
  addComputed(keypath: string, options: any): Computed | void {

    const instance = this,
    computed = Computed.build(keypath, instance.context, options)

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
  watch(keypath: any, watcher?: any, options?: any) {

    const instance = this,

    { context, syncEmitter, asyncEmitter } = instance,

    bind = function (keypath: string, func: Function, options: Object) {

      const emitter = options[WATCH_CONFIG_SYNC] ? syncEmitter : asyncEmitter

      emitter[options[WATCH_CONFIG_ONCE] ? 'once' : 'on'](
        keypath,
        {
          func,
          context,
        }
      )

      if (options[WATCH_CONFIG_IMMEDIATE]) {
        execute(
          func,
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
      bind(keypath, watcher, options || env.plain)
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
   * @param {string|Object} keypath
   * @param {Function} watcher
   */
  unwatch(keypath: any, watcher?: Function) {
    const { syncEmitter, asyncEmitter } = this,
    unbind = function (watcher: Function, keypath: string) {
      syncEmitter.off(keypath, watcher)
      asyncEmitter.off(keypath, watcher)
    }
    if (is.string(keypath)) {
      unbind(watcher, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, unbind)
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
    if (!is.number(max) || value <= max) {
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
    if (!is.numeric(min) || value >= min) {
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
  insert(keypath: string, item: any, index: any): boolean {

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
  removeAt(keypath: string, index: number): boolean {
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
  remove(keypath: string, item: any): boolean {
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
