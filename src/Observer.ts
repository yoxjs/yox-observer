import {
  Data,
  Watcher,
  ValueHolder,
  ComputedGetter,
  ComputedSetter,
} from 'yox-type/src/type'

import {
  WatcherOptions,
  ComputedOptions,
  EmitterOptions,
  EmitterFilter,
} from 'yox-type/src/options'

import * as is from 'yox-common/src/util/is'
import * as array from 'yox-common/src/util/array'
import * as object from 'yox-common/src/util/object'
import * as string from 'yox-common/src/util/string'
import * as constant from 'yox-common/src/util/constant'

import toNumber from 'yox-common/src/function/toNumber'
import Emitter from 'yox-common/src/util/Emitter'
import NextTask from 'yox-common/src/util/NextTask'
import * as keypathUtil from 'yox-common/src/util/keypath'

import Computed from './Computed'
import diffWatcher from './function/diffWatcher'
import formatWatcherOptions from './function/formatWatcherOptions'

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

  data: Data

  context: any

  nextTask: NextTask

  computed?: Record<string, Computed>

  syncEmitter: Emitter

  asyncEmitter: Emitter

  asyncOldValues: Record<string, any>

  asyncKeypaths: Record<string, Record<string, boolean>>

  pending?: boolean

  constructor(data?: Data, context?: any, nextTask?: NextTask) {

    const instance = this

    instance.data = data || { }
    instance.context = context || instance
    instance.nextTask = nextTask || new NextTask()

    instance.syncEmitter = new Emitter()
    instance.asyncEmitter = new Emitter()

    instance.asyncOldValues = { }
    instance.asyncKeypaths = { }

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

    { data, computed } = instance

    // 传入 '' 获取整个 data
    if (keypath === constant.EMPTY_STRING) {
      return data
    }

    // 调用 get 时，外面想要获取依赖必须设置是谁在收集依赖
    // 如果没设置，则跳过依赖收集
    if (currentComputed && !depIgnore) {
      currentComputed.add(keypath)
    }

    let result: ValueHolder | void

    if (computed) {
      result = object.get(computed, keypath)
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
    keypath: string | Data,
    value?: any
  ) {

    const instance = this,

    { data, computed } = instance,

    setValue = function (keypath: string, newValue: any) {

      const oldValue = instance.get(keypath)
      if (newValue === oldValue) {
        return
      }

      let next: any

      keypathUtil.each(
        keypath,
        function (key, index, lastIndex) {

          if (index === 0) {
            if (computed && computed[key]) {
              if (lastIndex === 0) {
                computed[key].set(newValue)
              }
              else {
                // 这里 next 可能为空
                next = computed[key].get()
              }
            }
            else {
              if (lastIndex === 0) {
                data[key] = newValue
              }
              else {
                next = data[key] || (data[key] = { })
              }
            }
            return
          }

          if (next) {
            if (index === lastIndex) {
              next[key] = newValue
            }
            else {
              next = next[key] || (next[key] = { })
            }
          }

        }
      )

      instance.diff(keypath, newValue, oldValue)

    }

    if (is.string(keypath)) {
      setValue(keypath as string, value)
    }
    else if (is.object(keypath)) {
      for (let key in keypath as Data) {
        setValue(key, (keypath as Data)[key])
      }
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
  ) {

    let instance = this,

    { syncEmitter, asyncEmitter, asyncOldValues, asyncKeypaths } = instance,

    /**
     * 我们认为 $ 开头的变量是不可递归的
     * 比如浏览器中常见的 $0 表示当前选中元素
     * DOM 元素是不能递归的
     */
    isRecursive = string.codeAt(keypath) !== 36

    diffWatcher(
      keypath, newValue, oldValue,
      syncEmitter.listeners, isRecursive,
      function (watchKeypath, keypath, newValue, oldValue) {

        syncEmitter.fire(
          {
            type: watchKeypath,
            ns: constant.EMPTY_STRING,
          },
          [
            newValue,
            oldValue,
            keypath,
          ]
        )

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
      function (watchKeypath, keypath, newValue, oldValue) {

        // 这里是为了解决上面说的坑
        const options = asyncEmitter.listeners[watchKeypath]
        for (let i = 0, length = options.length; i < length; i++) {
          (options[i].count as number)++
        }

        if (!asyncKeypaths[keypath]) {
          asyncOldValues[keypath] = oldValue
          asyncKeypaths[keypath] = { }
        }

        asyncKeypaths[keypath][watchKeypath] = constant.TRUE

        if (!instance.pending) {
          instance.pending = constant.TRUE
          instance.nextTask.append(
            function () {
              if (instance.pending) {
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
  private diffAsync() {

    const instance = this,

    { asyncEmitter, asyncOldValues, asyncKeypaths } = instance

    instance.pending = constant.UNDEFINED
    instance.asyncOldValues = { }
    instance.asyncKeypaths = { }

    for (let keypath in asyncOldValues) {

      const args = [
        instance.get(keypath),
        asyncOldValues[keypath],
        keypath,
      ],

      keypaths = asyncKeypaths[keypath],

      hasChange = args[0] !== args[1],

      filterWatcher = function (
        event: any,
        args: any,
        options: EmitterOptions
      ): boolean | void {

        // 前面递增了 count
        // 这里要递减 count
        // count > 0 表示前面标记了该监听器需要响应此次变化
        if (options.count) {

          // 采用计数器的原因是，同一个 options 可能执行多次
          // 比如监听 user.*，如果同批次修改了 user.name 和 user.age
          // 这个监听器会调用多次，如果第一次执行就把 count 干掉了，第二次就无法执行了
          options.count--

          // 新旧值不相等才能触发监听器
          return hasChange

        }

      }

      for (let watchKeypath in keypaths) {
        asyncEmitter.fire(
          {
            type: watchKeypath,
            ns: constant.EMPTY_STRING,
          },
          args,
          filterWatcher
        )
      }

    }

  }

  /**
   * 添加计算属性
   *
   * @param keypath
   * @param computed
   */
  addComputed(
    keypath: string,
    options: ComputedGetter | ComputedOptions
  ): Computed | void {

    let instance = this,

    context = instance.context,

    cache = constant.TRUE,

    sync = constant.TRUE,

    deps: string[] | void,

    getter: ComputedGetter | void,

    setter: ComputedSetter | void

    // 这里用 bind 方法转换一下调用的 this
    // 还有一个好处，它比 call(context) 速度稍快一些
    if (is.func(options)) {
      getter = (options as ComputedGetter).bind(context)
    }
    else if (is.object(options)) {
      const computedOptions = options as ComputedOptions
      if (is.boolean(computedOptions.cache)) {
        cache = computedOptions.cache as boolean
      }
      if (is.boolean(computedOptions.sync)) {
        sync = computedOptions.sync as boolean
      }
      // 传入空数组等同于没传
      if (!array.falsy(computedOptions.deps)) {
        deps = computedOptions.deps as string[]
      }
      if (is.func(computedOptions.get)) {
        getter = computedOptions.get.bind(context)
      }
      if (is.func(computedOptions.set)) {
        setter = (computedOptions.set as ComputedSetter).bind(context)
      }
    }

    if (getter) {

      const computed = new Computed(keypath, sync, cache, deps, instance, getter, setter)

      if (!instance.computed) {
        instance.computed = { }
      }

      instance.computed[keypath] = computed

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
  ) {

    const instance = this,

    { computed } = instance

    if (computed && object.has(computed, keypath)) {
      delete computed[keypath]
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
    keypath: string | Record<string, Watcher | WatcherOptions>,
    watcher?: Watcher | WatcherOptions,
    immediate?: boolean
  ) {

    const instance = this,

    { context, syncEmitter, asyncEmitter } = instance,

    addWatcher = function (keypath: string, options: WatcherOptions) {

      const emitter = options.sync ? syncEmitter : asyncEmitter,

      // formatWatcherOptions 保证了 options.watcher 一定存在
      listener: EmitterOptions = {
        ns: constant.EMPTY_STRING,
        listener: options.watcher,
        ctx: context,
        count: 0,
      }

      if (options.once) {
        listener.max = 1
      }

      emitter.on(keypath, listener)

      if (options.immediate) {
        options.watcher.call(
          context,
          instance.get(keypath),
          constant.UNDEFINED,
          keypath
        )
      }

    }

    if (is.string(keypath)) {
      addWatcher(
        keypath as string,
        formatWatcherOptions(watcher, immediate)
      )
    }
    else {
      for (let key in keypath as Record<string, Watcher | WatcherOptions>) {
        addWatcher(
          key,
          formatWatcherOptions(keypath[key])
        )
      }
    }

  }

  /**
   * 取消监听数据变化
   *
   * @param keypath
   * @param watcher
   */
  unwatch(
    keypath?: string,
    watcher?: Watcher
  ) {
    const filter: EmitterFilter = {
      ns: constant.EMPTY_STRING,
      listener: watcher,
    }
    this.syncEmitter.off(keypath, filter)
    this.asyncEmitter.off(keypath, filter)
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

    list = is.array(list) ? list.slice() : []

    const { length } = list
    if (index === constant.TRUE || index === length) {
      list.push(item)
    }
    else if (index === constant.FALSE || index === 0) {
      list.unshift(item)
    }
    else if (index > 0 && index < length) {
      list.splice(index, 0, item)
    }
    else {
      return
    }

    this.set(keypath, list)

    return constant.TRUE

  }

  /**
   * 在数组尾部添加元素
   *
   * @param keypath
   * @param item
   */
  append(keypath: string, item: any): true | void {
    return this.insert(keypath, item, constant.TRUE)
  }

  /**
   * 在数组首部添加元素
   *
   * @param keypath
   * @param item
   */
  prepend(keypath: string, item: any): true | void {
    return this.insert(keypath, item, constant.FALSE)
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
      list = list.slice()
      list.splice(index, 1)
      this.set(keypath, list)
      return constant.TRUE
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
      list = list.slice()
      if (array.remove(list, item)) {
        this.set(keypath, list)
        return constant.TRUE
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
