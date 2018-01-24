
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import isDef from 'yox-common/function/isDef'
import toNumber from 'yox-common/function/toNumber'
import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'


function updateValue(changes, newValue, oldValue, keypath) {
  if (!changes) {
    changes = { }
  }
  if (changes[ keypath ]) {
    changes[ keypath ].newValue = newValue
  }
  else {
    changes[ keypath ] = {
      newValue,
      oldValue,
    }
  }
  return changes
}

function eachKeypath(keypath, callback) {
  for (let i = 0, len = keypath.length; i < len;) {
    i = keypath.indexOf('.', i)
    if (i > 0) {
      callback(keypath.substr(0, i))
      i++
    }
    else {
      callback(keypath)
      break
    }
  }
}

let guid = 0
export class Watcher {

  constructor(keypath, callback) {
    this.id = ++guid
    this.keypath = keypath
    this.callback = callback
  }

  get() {
    let { value, dirty } = this
    // 减少取值频率，尤其是处理复杂的计算规则
    if (this.isDirty()) {
      let lastWatcher = Observer.watcher
      Observer.watcher = this
      value = this.value = this.getter()
      Observer.watcher = lastWatcher
      this.dirty = env.NULL
    }
    return value
  }

  update(newValue, oldValue, keypath) {
    this.dirty = updateValue(this.dirty, newValue, oldValue, keypath)
    let { callback } = this
    if (callback) {
      callback(newValue, oldValue, keypath, this)
    }
  }

  isDirty() {
    let { dirty } = this, result
    if (isDef(dirty)) {
      if (dirty) {
        object.each(
          dirty,
          function (item, keypath) {
            if (item.newValue !== item.oldValue) {
              result = env.TRUE
              return env.FALSE
            }
          }
        )
      }
    }
    else {
      result = env.TRUE
    }
    return result
  }

}

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
    instance.computed = { }
    instance.watchers = { }

    let changes, watchers
    instance.onChange = function (newValue, oldValue, keypath, watcher) {
      changes = updateValue(changes, newValue, oldValue, keypath)
      if (watcher) {
        if (!watchers) {
          watchers = { }
        }
        watchers[ watcher.id ] = watcher
      }
      if (!instance.pending) {
        instance.pending = env.TRUE
        instance.nextTick(
          function () {
            if (instance.pending) {
              instance.pending = env.FALSE

              if (watchers) {
                object.each(
                  watchers,
                  function (watcher) {
                    watcher.dirty = env.NULL
                  }
                )
                watchers = env.NULL
              }

              console.log('fire', changes)
              let existed = { }

              let { emitter } = instance
              let listeners = object.keys(emitter.listeners)
              object.each(
                changes,
                function (item, keypath) {
                  if (item.newValue !== item.oldValue) {
                    let args = [ item.newValue, item.oldValue, keypath ]
                    emitter.fire(keypath, args)
                    console.log('file', keypath, args)
                    array.each(
                      listeners,
                      function (key) {
                        let match
                        if (isFuzzyKeypath(key) && (match = matchKeypath(keypath, key))) {
                          let newArgs = object.copy(args)
                          array.push(newArgs, match)
                          emitter.fire(key, newArgs)
                          console.log('file', key, newArgs)
                        }
                      }
                    )
                  }
                }
              )
              changes = env.NULL
            }
          }
        )
      }
    }

    if (options.computed) {
      object.each(
        options.computed,
        function (item, keypath) {
          instance.addComputed(keypath, item)
        }
      )
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
console.log('get', keypath)
    // 调用 get 时，外面想要获取依赖必须设置是谁在收集依赖
    // 如果没设置，则跳过依赖收集
    let watcher = Observer.watcher
    if (watcher) {
      eachKeypath(
        keypath,
        function (subKeypath) {
          instance.addWatcher(watcher, subKeypath, keypath)
        }
      )
    }

    let { target, prop } = matchBest(instance.computed, keypath)
    if (target) {
      target = target.get()
      if (prop) {
        if (object.exists(target, prop)) {
          result = { value: target[ prop ] }
        }
        else if (!is.primitive(target)) {
          result = object.get(target, prop)
        }
      }
      else {
        result = { value: target }
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
   * @param {string|Object} keypath
   * @param {?*} value
   */
  set(keypath, value) {

    let instance = this

    let setValue = function (value, keypath) {

      keypath = keypathUtil.normalize(keypath)

      let newValue = value, oldValue = instance.get(keypath)
      if (newValue === oldValue) {
        return
      }

      let { watchers, context } = instance

      let getValue = function (key) {
        key = string.slice(key, keypathUtil.startsWith(key, keypath))
        if (key) {
          key = object.get(value, key)
          if (key) {
            return key.value
          }
        }
        else {
          return value
        }
      }

      let match, hasFuzzy
      console.log('!!!!', keypath, value, watchers)
      for (let watchKey in watchers) {
        console.log('------', watchKey, keypath)
        if (isFuzzyKeypath(watchKey)) {
          hasFuzzy = env.TRUE
        }
        else if (watchKey.indexOf(keypath) === 0) {
          newValue = getValue(watchKey)
          oldValue = instance.get(watchKey)
          console.log('diff', watchKey, keypath, newValue, oldValue)
          if (newValue !== oldValue) {
            array.each(
              watchers[ watchKey ],
              function (item) {
                let { targetKey, watcher } = item
                if (targetKey !== watchKey) {
                  newValue = getValue(targetKey)
                  oldValue = instance.get(targetKey)
                  if (newValue === oldValue) {
                    return
                  }
                }
                watcher.update(newValue, oldValue, targetKey)
              }
            )
          }
        }
      }

      if (hasFuzzy) {

      }

      let target = instance.computed[ keypath ]
      if (target && target.setter) {
        target.setter(value)
      }
      else {
        let { target, prop } = matchBest(instance.computed, keypath)
        if (target && prop) {
          target = target.get()
          if (is.primitive(target)) {
            return
          }
          else {
            object.set(target, prop, value)
          }
        }
        else {
          object.set(instance.data, keypath, value)
        }
      }
    }

    if (is.string(keypath)) {
      setValue(value, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, setValue)
    }

  }

  /**
   * 添加数据监听
   *
   * @param {Watcher} watcher
   * @param {string} watchKey
   * @param {?string} targetKey
   */
  addWatcher(watcher, watchKey, targetKey) {
    console.log('add', watchKey, targetKey)
    let watchers = this.watchers[ watchKey ] || (this.watchers[ watchKey ] = [ ])
    watchers.push({
      watcher,
      targetKey: targetKey || watchKey,
    })
  }

  /**
   * 移除数据监听
   *
   * @param {Watcher} watcher
   * @param {?string} watchKey
   */
  removeWatcher(watcher, watchKey) {
    console.log('remove ' + watchKey)
    let { watchers } = this
    if (watchers) {
      let remove = function (list, watchKey) {
        array.each(
          list,
          function (item, index) {
            if (item.watcher === watcher) {
              list.splice(index, 1)
            }
          },
          env.TRUE
        )
      }
      if (watchKey) {
        let list = watchers[ watchKey ]
        if (list) {
          remove(list, watchKey)
        }
      }
      else {
        object.each(watchers, remove)
      }
    }
  }

  /**
   * 添加计算属性
   *
   * @param {string} keypath
   * @param {Function|Object} computed
   */
  addComputed(keypath, computed) {

    let instance = this, get, set, deps

    if (is.func(computed)) {
      get = computed
    }
    else if (is.object(computed)) {
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

    if (get || set) {

      let watcher = new Watcher(keypath, instance.onChange)

      if (get) {
        if (is.array(deps)) {
          array.each(
            deps,
            function (dep) {
              instance.addWatcher(watcher, dep)
            }
          )
        }
        watcher.getter = function () {
          instance.removeWatcher(watcher)
          return execute(get, instance.context)
        }
      }

      if (set) {
        watcher.setter = function (value) {
          set.call(instance.context, value)
        }
      }

      this.computed[ keypath ] = watcher

    }

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
     * @param {Function} watcher
     */
    unwatch: function (keypath, watcher) {
      let { emitter } = this
      if (is.string(keypath)) {
        emitter.off(keypath, watcher)
      }
      else if (is.object(keypath)) {
        object.each(
          keypath,
          function (watcher, keypath) {
            emitter.off(keypath, watcher)
          }
        )
      }
    }

  }
)

function createWatch(action) {

  let watch = function (instance, keypath, watcher, sync) {

    let { emitter, context } = instance

    let data = {
      context,
      func: watcher,
      watchers: [ ],
      onAdd: function () {
        let addWatcher = function (subKeypath, keypath) {
          let watcher = new Watcher(subKeypath, instance.onChange)
          array.push(data.watchers, watcher)
          instance.addWatcher(watcher, subKeypath, keypath)
        }
        if (isFuzzyKeypath(keypath)) {
          addWatcher(keypath)
        }
        else {
          eachKeypath(
            keypath,
            function (subKeypath) {
              addWatcher(subKeypath, keypath)
            }
          )
        }
      },
      onRemove: function () {
        array.each(
          data.watchers,
          function (watcher) {
            instance.removeWatcher(watcher, watcher.keypath)
          }
        )
      }
    }

    emitter[ action ](keypath, data)
    if (sync && !isFuzzyKeypath(keypath)) {
      execute(
        watcher,
        context,
        [ instance.get(keypath), env.UNDEFINED, keypath ]
      )
    }

  }

  return function (keypath, watcher, sync) {

    let instance = this

    if (is.string(keypath)) {
      watch(instance, keypath, watcher, sync)
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
          watch(instance, keypath, watcher, innerSync)
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
 * @param {Object} obj
 * @param {string} keypath
 * @return {Object}
 */
function matchBest(obj, keypath) {

  let result = { }

  array.each(
    object.sort(obj, env.TRUE),
    function (prefix) {
      let length = keypathUtil.startsWith(keypath, prefix)
      if (length !== env.FALSE) {
        result.target = obj[ prefix ]
        result.prop = string.slice(keypath, length)
        return env.FALSE
      }
    }
  )

  return result

}
