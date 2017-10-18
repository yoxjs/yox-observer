
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

export default class Observer {

  /**
   * @param {Object} options
   * @property {Object} options.data
   * @property {?Object} options.computed
   * @property {?*} options.context 执行 watcher 函数的 this 指向
   */
  constructor(options) {

    let instance = this

    instance.data = options.data || { }
    instance.context = options.context || instance
    instance.emitter = new Emitter()

    // 缓存历史数据，便于对比变化
    instance.cache = { }
    // 谁依赖了谁
    instance.deps = { }

    // 把计算属性拆为 getter 和 setter
    instance.computedGetters = { }
    instance.computedSetters = { }

    // 辅助获取计算属性的依赖
    instance.computedStack = [ ]

    // 计算属性也是数据
    if (is.object(options.computed)) {
      object.each(
        options.computed,
        function (item, keypath) {
          instance.addComputed(keypath, item)
        }
      )
    }

  }

  /**
   * 添加计算属性
   *
   * @param {string} keypath
   * @param {Function|Object} computed
   */
  addComputed(keypath, computed) {

    let instance = this, cacheable = env.TRUE, get, set, deps

    if (is.func(computed)) {
      get = computed
    }
    else if (is.object(computed)) {
      if (is.boolean(computed.cache)) {
        cacheable = computed.cache
      }
      if (is.func(computed.get)) {
        get = computed.get
      }
      if (is.func(computed.set)) {
        set = computed.set
      }
      if (computed.deps) {
        deps = computed.deps
      }
    }

    if (get) {

      let needDeps

      if (deps) {
        needDeps = env.FALSE
        if (is.array(deps)) {
          instance.setDeps(keypath, deps)
        }
      }
      else {
        needDeps = cacheable
      }

      instance.computedGetters[ keypath ] = function () {

        if (cacheable && object.has(instance.cache, keypath)) {
          return instance.cache[ keypath ]
        }

        if (needDeps) {
          instance.computedStack.push([ ])
        }

        let value = execute(get, instance.context)
        instance.cache[ keypath ] = value

        if (needDeps) {
          instance.setDeps(
            keypath,
            array.pop(instance.computedStack)
          )
        }

        return value

      }

    }

    if (set) {
      instance.computedSetters[ keypath ] = function (value) {
        set.call(instance.context, value)
      }
    }

  }

  /**
   * 获取数据
   *
   * @param {string} keypath
   * @param {?*} defaultValue
   * @return {?*}
   */
  get(keypath, defaultValue) {

    let instance = this, result

    // 传入 '' 获取整个 data
    if (keypath === char.CHAR_BLANK) {
      return instance.data
    }

    keypath = keypathUtil.normalize(keypath)

    // 收集计算属性依赖
    let list = array.last(instance.computedStack)
    if (list) {
      array.push(list, keypath)
    }

    let { getter, prop } = matchBestGetter(instance.computedGetters, keypath)
    if (getter) {
      getter = getter()
      if (prop) {
        if (object.exists(getter, prop)) {
          result = { value: getter[ prop ] }
        }
        else if (!is.primitive(getter)) {
          result = object.get(getter, prop)
        }
      }
      else {
        result = { value: getter }
      }
    }

    if (!result) {
      result = object.get(instance.data, keypath)
    }

    if (result) {
      return instance.cache[ keypath ] = result.value
    }

    instance.cache[ keypath ] = env.UNDEFINED
    return defaultValue

  }

  /**
   * 更新数据
   *
   * @param {string|Object} keypath
   * @param {?*} value
   * @param {?boolean} sync
   */
  set(keypath, value, sync) {

    let model, result = [ ]
    if (is.string(keypath)) {
      model = { }
      model[ keypath ] = value
    }
    else if (is.object(keypath)) {
      model = keypath
      sync = value
    }
    else {
      return result
    }

    let instance = this

    let {
      deps,
      data,
      cache,
      emitter,
      computedGetters,
      computedSetters,
      watchKeypaths,
      watchFuzzyKeypaths,
    } = instance

    if (instance[ DIRTY ]) {

      delete instance[ DIRTY ]

      watchKeypaths = instance.watchKeypaths = { }
      watchFuzzyKeypaths = instance.watchFuzzyKeypaths = { }

      object.each(
        emitter.listeners,
        function (list, key) {
          if (isFuzzyKeypath(key)) {
            watchFuzzyKeypaths[ key ] = env.TRUE
          }
          else {
            watchKeypaths[ key ] = env.TRUE
          }
        }
      )

    }

    /**
     * 修改数据分 3 步：
     *
     * 1. 预分析所有潜在的 watch 字段，并提取出 oldValue
     * 2. 设值
     * 3. 遍历第一步收集的所有 watch 字段，并提取出 newValue 进行对比
     */

    let oldCache = { }
    let getOldValue = function (keypath) {
      if (!object.has(oldCache, keypath)) {
        oldCache[ keypath ] =
        object.has(cache, keypath)
          ? cache[ keypath ]
          : instance.get(keypath)
      }
      return oldCache[ keypath ]
    }

    let newCache = { }
    let getNewValue = function (keypath) {
      if (!object.has(newCache, keypath)) {
        newCache[ keypath ] = instance.get(keypath)
      }
      return newCache[ keypath ]
    }

    let tasks = [ ], taskKeys = { }

    let addTask = function (keypath) {
      if (!taskKeys[ keypath ]) {
        taskKeys[ keypath ] = env.TRUE
        array.push(
          tasks,
          {
            keypath,
            oldValue: getOldValue(keypath),
          }
        )
      }
    }

    /**
     * 当一个值变化时（对应 keypath)
     * 分析依赖它的那些数据是否发生了变化
     *
     * @param {string} keypath
     * @param {string} testKey
     * @return {?Array}
     */
    let testDeps = function (keypath, testKey) {
      let result
      array.each(
        deps[ testKey ],
        function (dep) {
          if (isFuzzyKeypath(dep)) {
            result = matchKeypath(keypath, dep)
          }
          else {
            result = keypathUtil.startsWith(dep, keypath)
          }
          if (!result && object.has(deps, dep)) {
            result = testDeps(keypath, dep)
          }
          if (result) {
            return env.FALSE
          }
        }
      )
      return result
    }

    let depKeys = object.keys(deps)
    let matchDeps = function (keypath) {

      let hasFound

      while (env.TRUE) {
        hasFound = env.FALSE
        array.each(
          depKeys,
          function (key) {
            if (key !== keypath && !taskKeys[ key ] && testDeps(keypath, key)) {
              hasFound = env.TRUE
              addTask(key)
              matchDeps(key)
            }
          }
        )
        if (!hasFound) {
          break
        }
      }

    }

    object.each(
      model,
      function (newValue, keypath) {

        keypath = keypathUtil.normalize(keypath)

        let oldValue = getOldValue(keypath)
        if (newValue !== oldValue) {

          addTask(keypath)

          if (watchKeypaths) {
            object.each(
              watchKeypaths,
              function (value, key) {
                if (key !== keypath
                  && keypathUtil.startsWith(key, keypath)
                ) {
                  addTask(key)
                }
              }
            )
          }

          matchDeps(keypath)

        }

        if (computedSetters) {
          let setter = computedSetters[ keypath ]
          if (setter) {
            setter(newValue)
            return
          }
          else {
            let { getter, prop } = matchBestGetter(computedGetters, keypath)
            if (getter && prop) {
              getter = getter()
              if (!is.primitive(getter)) {
                object.set(getter, prop, newValue)
              }
              return
            }
          }
        }

        object.set(data, keypath, newValue)

      }
    )

    let cacheKeys = object.keys(cache)

    array.each(
      tasks,
      function (task) {

        let { keypath, oldValue } = task

        // 清掉计算属性的缓存
        if (object.has(cache, keypath)) {
          delete cache[ keypath ]
        }

        if (getNewValue(keypath) !== oldValue) {

          if (!array.has(result, keypath)) {
            array.push(result, keypath)
          }

          let differences = instance.differences || (instance.differences = { })
          differences[ keypath ] = task

          array.each(
            cacheKeys,
            function (key) {
              if (key !== keypath
                && keypathUtil.startsWith(key, keypath)
              ) {
                delete cache[ key ]
              }
            }
          )

        }

      }
    )

    if (result.length) {
      if (sync) {
        instance.flush()
      }
      else {
        instance.flushAsync()
      }
    }

    return result

  }

  flush() {

    let instance = this

    if (instance.pending) {
      delete instance.pending
    }

    // 冻结这批变化
    // 避免 fire 之后同步再次走进这里
    let { emitter, differences, watchFuzzyKeypaths } = instance
    if (differences) {
      delete instance.differences

      let sortedList = [ ]

      object.each(
        differences,
        function (difference, keypath) {
          array[
            string.startsWith(keypath, '_') ? 'unshift' : 'push'
          ](sortedList, difference)
        }
      )

      array.each(
        sortedList,
        function (difference) {
          let { keypath, oldValue } = difference, newValue = instance.get(keypath)
          if (difference.force || oldValue !== newValue) {
            let args = [ newValue, oldValue, keypath ]
            emitter.fire(keypath, args)
            if (watchFuzzyKeypaths) {
              object.each(
                watchFuzzyKeypaths,
                function (value, key) {
                  let match = matchKeypath(keypath, key)
                  if (match) {
                    let newArgs = object.copy(args)
                    array.push(newArgs, match)
                    emitter.fire(key, newArgs)
                  }
                }
              )
            }
          }
        }
      )

    }

  }

  flushAsync() {
    let instance = this
    if (!instance.pending) {
      instance.pending = env.TRUE
      nextTask.append(
        function () {
          if (instance.pending) {
            instance.flush()
          }
        }
      )
    }
  }

  setDeps(keypath, deps) {
    this.deps[ keypath ] = deps
  }

  /**
   * 取反 keypath 对应的数据
   *
   * 不管 keypath 对应的数据是什么类型，操作后都是布尔型
   *
   * @param {string} keypath
   * @return {boolean} 取反后的布尔值
   */
  toggle(keypath) {
    let value = !this.get(keypath)
    this.set(keypath, value)
    return value
  }

  /**
   * 递增 keypath 对应的数据
   *
   * 注意，最好是整型的加法，如果涉及浮点型，不保证计算正确
   *
   * @param {string} keypath 值必须能转型成数字，如果不能，则默认从 0 开始递增
   * @param {?number} step 步进值，默认是 1
   * @param {?number} min 可以递增到的最小值，默认不限制
   * @return {number} 返回递增后的值
   */
  increase(keypath, step, max) {
    let value = toNumber(this.get(keypath), 0) + (is.numeric(step) ? step : 1)
    if (!is.numeric(max) || value <= max) {
      this.set(keypath, value)
    }
    return value
  }

  /**
   * 递减 keypath 对应的数据
   *
   * 注意，最好是整型的减法，如果涉及浮点型，不保证计算正确
   *
   * @param {string} keypath 值必须能转型成数字，如果不能，则默认从 0 开始递减
   * @param {?number} step 步进值，默认是 1
   * @param {?number} min 可以递减到的最小值，默认不限制
   * @return {number} 返回递减后的值
   */
  decrease(keypath, step, min) {
    let value = toNumber(this.get(keypath), 0) - (is.numeric(step) ? step : 1)
    if (!is.numeric(min) || value >= min) {
      this.set(keypath, value)
    }
    return value
  }

  /**
   * 在数组指定位置插入元素
   *
   * @param {string} keypath
   * @param {*} item
   * @param {number} index
   * @return {?boolean} 是否插入成功
   */
  insert(keypath, item, index) {

    let list = this.get(keypath)
    if (!is.array(list)) {
      list = [ ]
    }
    else {
      list = object.copy(list)
    }

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
   * @param {string} keypath
   * @param {number} index
   * @return {?boolean} 是否移除成功
   */
  removeAt(keypath, index) {
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
   * @param {string} keypath
   * @param {*} item
   * @return {?boolean} 是否移除成功
   */
  remove(keypath, item) {
    let list = this.get(keypath)
    if (is.array(list)) {
      list = object.copy(list)
      if (array.remove(list, item)) {
        this.set(keypath, list)
        return env.TRUE
      }
    }
  }

  nextTick(fn) {
    nextTask.append(fn)
  }

  /**
   * 销毁
   */
  destroy() {
    this.emitter.off()
    object.clear(this)
  }

}

object.extend(
  Observer.prototype,
  {

    /**
     * 监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watch: createWatch('on'),

    /**
     * 监听一次数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watchOnce: createWatch('once'),

    /**
     * 取消监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     */
    unwatch: function (keypath, watcher) {
      let { emitter } = this
      if (emitter.has(keypath)) {
        emitter.off(keypath, watcher)
        if (!emitter.has(keypath)) {
          this[ DIRTY ] = env.TRUE
        }
      }
    }

  }
)

const DIRTY = '_dirty_'

function watch(instance, action, keypath, watcher, sync) {

  let { emitter, context, differences } = instance

  if (!emitter.has(keypath)) {
    instance[ DIRTY ] = env.TRUE
  }

  emitter[ action ](
    keypath,
    {
      func: watcher,
      context
    }
  )

  if (sync && !isFuzzyKeypath(keypath)) {
    if (differences) {
      let difference = differences[ keypath ]
      if (difference) {
        difference.force = env.TRUE
        return
      }
    }
    execute(
      watcher,
      context,
      [ instance.get(keypath), env.UNDEFINED, keypath ]
    )
  }

}

function createWatch(action) {

  return function (keypath, watcher, sync) {

    let instance = this

    if (is.string(keypath)) {
      watch(instance, action, keypath, watcher, sync)
    }
    else {
      if (watcher === env.TRUE) {
        sync = watcher
      }
      object.each(
        keypath,
        function (value, keypath) {
          let watcher = value, innerSync = sync
          if (is.object(value)) {
            watcher = value.watcher
            if (is.boolean(value.sync)) {
              innerSync = value.sync
            }
          }
          watch(instance, action, keypath, watcher, innerSync)
        }
      )
    }

  }

}

let patternCache = { }

/**
 * 模糊匹配 Keypath
 *
 * @param {string} keypath
 * @param {string} pattern
 * @return {?Array.<string>}
 */
function matchKeypath(keypath, pattern) {
  let cache = patternCache[ pattern ]
  if (!cache) {
    cache = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '([\.\\w]+?)')
      .replace(/\*/g, '(\\w+)')
    cache = patternCache[ pattern ] = new RegExp(`^${cache}$`)
  }
  let match = keypath.match(cache)
  if (match) {
    return array.toArray(match).slice(1)
  }
}

/**
 * 是否模糊匹配
 *
 * @param {string} keypath
 * @return {boolean}
 */
function isFuzzyKeypath(keypath) {
  return string.has(keypath, '*')
}

/**
 * 从 getter 对象的所有 key 中，选择和 keypath 最匹配的那一个
 *
 * @param {Object} getters
 * @param {string} keypath
 * @return {Object}
 */
function matchBestGetter(getters, keypath) {

  let result = { }

  array.each(
    object.sort(getters, env.TRUE),
    function (prefix) {
      let length = keypathUtil.startsWith(keypath, prefix)
      if (length !== env.FALSE) {
        result.getter = getters[ prefix ]
        result.prop = string.slice(keypath, length)
        return env.FALSE
      }
    }
  )

  return result

}
