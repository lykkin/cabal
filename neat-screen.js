var chalk = require('chalk')
var collect = require('collect-stream')
var Commander = require('./commands.js')
var fs = require('fs')
var neatLog = require('neat-log')
var strftime = require('strftime')
var views = require('./views')
var yaml = require('js-yaml')
var emojiRegex = require('emoji-regex')
var emojiPattern = emojiRegex()
var util = require('./util')

var markdown = require('./markdown-shim')
var statusMessages = ['welcome to cabal', 'for more info visit https://github.com/cabal-club/cabal']
statusMessages = statusMessages.map(util.wrapStatusMsg)

function NeatScreen (props) {
  if (!(this instanceof NeatScreen)) return new NeatScreen(props)
  this.archivesdir = props.archivesdir
  this.configFilePath = props.configFilePath
  this.config = props.config
  this.isExperimental = props.isExperimental
  this.client = props.client

  this.commander = Commander(this, props.cabals[0])

  this.neat = neatLog(renderApp, { fullscreen: true,
    style: function (start, cursor, end) {
      if (!cursor) cursor = ' '
      return start + chalk.underline(cursor) + end
    } }
  )
  this.neat.input.on('update', () => this.neat.render())
  this.neat.input.on('enter', (line) => this.commander.process(line))

  this.neat.input.on('tab', () => {
    var line = this.neat.input.rawLine()
    if (line.length > 1 && line[0] === '/') {
      // command completion
      var soFar = line.slice(1)
      var commands = Object.keys(this.commander.commands)
      var matchingCommands = commands.filter(cmd => cmd.startsWith(soFar))
      if (matchingCommands.length === 1) {
        this.neat.input.set('/' + matchingCommands[0])
      }
    } else {
      const cabalUsers = this.client.getUsers()
      // nick completion
      var users = Object.keys(cabalUsers)
        .map(key => cabalUsers[key])
        .map(user => user.name || user.key.substring(0, 8))
        .sort()
      var pattern = (/^(\w+)$/)
      var match = pattern.exec(line)

      if (match) {
        users = users.filter(user => user.startsWith(match[0]))
        if (users.length > 0) this.neat.input.set(users[0] + ': ')
      }
    }
  })

  this.neat.input.on('up', () => {
    if (this.commander.history.length) {
      var command = this.commander.history.pop()
      this.commander.history.unshift(command)
      this.neat.input.set(command)
    }
  })

  this.neat.input.on('down', () => {
    if (this.commander.history.length) {
      var command = this.commander.history.shift()
      this.commander.history.push(command)
      this.neat.input.set(command)
    }
  })

  // set channel with alt-#
  this.neat.input.on('alt-1', () => { setChannelByIndex(0) })
  this.neat.input.on('alt-2', () => { setChannelByIndex(1) })
  this.neat.input.on('alt-3', () => { setChannelByIndex(2) })
  this.neat.input.on('alt-4', () => { setChannelByIndex(3) })
  this.neat.input.on('alt-5', () => { setChannelByIndex(4) })
  this.neat.input.on('alt-6', () => { setChannelByIndex(5) })
  this.neat.input.on('alt-7', () => { setChannelByIndex(6) })
  this.neat.input.on('alt-8', () => { setChannelByIndex(7) })
  this.neat.input.on('alt-9', () => { setChannelByIndex(8) })
  this.neat.input.on('alt-0', () => { setChannelByIndex(9) })

  this.neat.input.on('keypress', (ch, key) => {
    if (!key || !key.name) return
    if (key.name === 'home') this.neat.input.cursor = 0
    else if (key.name === 'end') this.neat.input.cursor = this.neat.input.rawLine().length
    else return
    this.bus.emit('render')
  })

  // move between window panes with ctrl+j
  this.neat.input.on('alt-n', () => {
    var currentIdx = this.state.windowPanes.indexOf(this.state.selectedWindowPane)
    if (currentIdx !== -1) {
      currentIdx++
      currentIdx = currentIdx % self.state.windowPanes.length
      setSelectedWindowPaneByIndex(currentIdx)
    }
  })

  // move up/down channels with ctrl+{n,p}
  this.neat.input.on('ctrl-p', () => {
    var currentIdx
    if (this.state.selectedWindowPane === 'cabals') {
      currentIdx = this.state.cabals.findIndex((cabal) => cabal.key === this.commander.cabal.key)
      if (currentIdx !== -1) {
        currentIdx--
        if (currentIdx < 0) currentIdx = this.state.cabals.length - 1
        setCabalByIndex(currentIdx)
      }
    } else {
      currentIdx = this.state.cabal.client.channels.indexOf(this.commander.channel)
      if (currentIdx !== -1) {
        currentIdx--
        if (currentIdx < 0) currentIdx = this.state.cabal.client.channels.length - 1
        setChannelByIndex(currentIdx)
      }
    }
  })
  this.neat.input.on('ctrl-n', () => {
    var currentIdx
    if (this.state.selectedWindowPane === 'cabals') {
      currentIdx = this.state.cabals.findIndex((cabal) => cabal.key === this.commander.cabal.key)
      if (currentIdx !== -1) {
        currentIdx++
        currentIdx = currentIdx % this.state.cabals.length
        setCabalByIndex(currentIdx)
      }
    } else {
      currentIdx = this.state.cabal.client.channels.indexOf(this.commander.channel)
      if (currentIdx !== -1) {
        currentIdx++
        currentIdx = currentIdx % this.state.cabal.client.channels.length
        setChannelByIndex(currentIdx)
      }
    }
  })

  function setCabalByIndex (n) {
    if (n < 0 || n >= self.state.cabals.length) return
    self.showCabal(self.state.cabals[n])
  }

  function setChannelByIndex (n) {
    if (n < 0 || n >= self.state.cabal.client.channels.length) return
    self.commander.channel = self.state.cabal.client.channels[n]
    self.loadChannel(self.state.cabal.client.channels[n])
  }

  function setSelectedWindowPaneByIndex (n) {
    if (n < 0 || n >= self.state.windowPanes.length) return
    self.state.selectedWindowPane = self.state.windowPanes[n]
  }

  this.neat.input.on('ctrl-d', () => process.exit(0))
  this.neat.input.on('pageup', () => this.state.scrollback++)
  this.neat.input.on('pagedown', () => { this.state.scrollback = Math.max(0, this.state.scrollback - 1); return null })

  this.neat.use((state, bus) => {
    state.neat = this.neat
    this.state = state
    this.bus = bus

    this.state.messages = []
    this.state.cabalKey = ''
    Object.defineProperty(this.state, 'cabal', {
      get: () => {
        return this.client.cabalToDetails()
      }
    })
    Object.defineProperty(this.state, 'cabals', {
      get: () => {
        return this.client.getCabalKeys()
      }
    })

    state.selectedWindowPane = 'channels'
    state.windowPanes = [state.selectedWindowPane]
  })
}

NeatScreen.prototype.initializeCabalClient = function (cabal) {
  this.client.addCabal(cabal).then((details) => {
    this.state.cabal = details
    this.cabalKey = cabal.key
    details.on('update', (details) => {
      this.state.cabal = details
      this.bus.emit('render')
    })
    this.client.openChannel("default")
  })
  // {
  //   channel: '!status',
  //   channels: ['!status'],
  //   messages: [],
  //   user: { local: true, online: true, key: '' },
  //   users: {}
  // }


  // cabal.ready(function () {
  //   cabal.channels.get((err, channels) => {
  //     if (err) return
  //     cabal.client.channels = cabal.client.channels.concat(channels)
      // self.loadChannel(cabal.client.channel)

      // cabal.channels.events.on('add', function (channel) {
      //   cabal.client.channels.push(channel)
      //   cabal.client.channels.sort()
      // })
    // })

    // cabal.users.getAll(function (err, users) {
    //   if (err) return
    //   cabal.client.users = users

    //   updateLocalKey()

    //   cabal.users.events.on('update', function (key) {
    //     // TODO: rate-limit
    //     cabal.users.get(key, function (err, user) {
    //       if (err) return
    //       cabal.client.users[key] = Object.assign(cabal.client.users[key] || {}, user)
    //       if (cabal.client.user && key === cabal.client.user.key) cabal.client.user = cabal.client.users[key]
    //       if (!cabal.client.user) updateLocalKey()
    //       self.bus.emit('render')
    //     })

    //     cabal.topics.events.on('update', function (msg) {
    //       self.state.topic = msg.value.content.topic
    //       self.bus.emit('render')
    //     })
    //   })

    //   cabal.on('peer-added', function (key) {
    //     var found = false
    //     Object.keys(cabal.client.users).forEach(function (k) {
    //       if (k === key) {
    //         cabal.client.users[k].online = true
    //         found = true
    //       }
    //     })
    //     if (!found) {
    //       cabal.client.users[key] = {
    //         key: key,
    //         online: true
    //       }
    //     }
    //     self.bus.emit('render')
    //   })
    //   cabal.on('peer-dropped', function (key) {
    //     Object.keys(cabal.client.users).forEach(function (k) {
    //       if (k === key) {
    //         cabal.client.users[k].online = false
    //         self.bus.emit('render')
    //       }
    //     })
    //   })

    //   function updateLocalKey () {
    //     cabal.getLocalKey(function (err, lkey) {
    //       // set local key for local user
    //       cabal.client.user.key = lkey
    //       if (err) return self.bus.emit('render')
    //       // try to get more data for user
    //       Object.keys(users).forEach(function (key) {
    //         if (key === lkey) {
    //           cabal.client.user = users[key]
    //           cabal.client.user.local = true
    //           cabal.client.user.online = true
    //         }
    //       })
    //       self.bus.emit('render')
    //     })
    //   }
    // })
  // })
}

NeatScreen.prototype.addCabal = function (key) {
  if (!self.isExperimental) { return }
  this.client.addCabal(key).then((cabal) => {
    this.showCabal(cabal)
    this.config.cabals = this.client.getCabalKeys()
    saveConfig(this.config, this.configFilePath)
  })
}

NeatScreen.prototype.showCabal = function (cabal) {
  this.state.cabal = cabal
  this.state.cabal.client = cabal.client
  this.commander.cabal = cabal
  this.loadChannel(this.state.cabal.client.channel)
  this.bus.emit('render')
}

function renderApp (state) {
  if (process.stdout.columns > 80) return views.big(state)
  else return views.small(state)
}

// use to write anything else to the screen, e.g. info iessages or emotes
NeatScreen.prototype.writeLine = function (line) {
  var msg = `${chalk.dim(line)}`
  this.state.messages.push(msg)
  statusMessages.push(util.wrapStatusMsg(msg))
  this.bus.emit('render')
}

NeatScreen.prototype.clear = function () {
  this.state.messages = []
  this.bus.emit('render')
}

NeatScreen.prototype.loadChannel = function (channel) {
  const self = this
  if (this.state.msgListener) {
    this.state.cabal.messages.events.removeListener(self.state.cabal.client.channel, self.state.cabal.client.msgListener)
    self.state.cabal.client.msgListener = null
  }

  self.state.cabal.client.channel = channel

  // clear the old channel state
  self.state.scrollback = 0
  self.state.messages = []
  self.state.topic = ''
  self.neat.render()

  if (channel === '!status') {
    self.state.messages = statusMessages.map(self.formatMessage)
    self.neat.render()
    return
  }

  var pending = 0
  function onMessage () {
    if (pending > 0) {
      pending++
      return
    }
    pending = 1

    // TODO: wrap this up in a nice interface and expose it via cabal-client
    var rs = self.state.cabal.messages.read(channel, { limit: MAX_MESSAGES, lt: '~' })
    collect(rs, function (err, msgs) {
      if (err) return
      msgs.reverse()

      self.state.messages = []
      var latestTimestamp = new Date(0)

      msgs.forEach(function (msg) {
        var msgDate = new Date(msg.value.timestamp)
        if (strftime('%F', msgDate) > strftime('%F', latestTimestamp)) {
          latestTimestamp = msgDate
          self.state.messages.push(`${chalk.gray('day changed to ' + strftime('%e %b %Y', latestTimestamp))}`)
        }
        self.state.messages.push(self.formatMessage(msg))
      })

      self.neat.render()

      self.state.cabal.topics.get(channel, (err, topic) => {
        if (err) return
        if (topic) {
          self.state.topic = topic
          self.neat.render()
        }
      })

      if (pending > 1) {
        pending = 0
        onMessage()
      } else {
        pending = 0
      }
    })
  }

  self.state.cabal.messages.events.on(channel, onMessage)
  self.state.cabal.client.msgListener = onMessage

  onMessage()
}

NeatScreen.prototype.render = function () {
  this.bus.emit('render')
}

NeatScreen.prototype.formatMessage = function (msg) {
  var highlight = false
  /*
   msg = {
     key: ''
     value: {
       timestamp: ''
       type: ''
       content: {
         text: ''
       }
     }
   }
  */
  if (!msg.value.type) { msg.value.type = 'chat/text' }
  if (msg.value.content && msg.value.timestamp) {
    const users = this.client.getUsers()
    const authorSource = users[msg.key] || msg

    const author = authorSource.name || authorSource.key.slice(0, 8)
    var localNick = 'uninitialized'
    if (self.state) {
      localNick = self.state.cabal.client.user.name
    }
    // emojis.break the cli: replace them with a cabal symbol
    var msgtxt = msg.value.content.text.replace(emojiPattern, '➤')
    if (msgtxt.indexOf(localNick) > -1 && author !== localNick) { highlight = true }

    var color = keyToColour(msg.key) || colours[5]

    var timestamp = `${chalk.dim(formatTime(msg.value.timestamp))}`
    var authorText = `${chalk.dim('<')}${highlight ? chalk.whiteBright(author) : chalk[color](author)}${chalk.dim('>')}`
    var content = markdown(msgtxt)

    var emote = (msg.value.type === 'chat/emote')

    if (emote) {
      authorText = `${chalk.white(author)}`
      content = `${chalk.dim(msgtxt)}`
    }

    if (msg.value.type === 'chat/topic') {
      content = `${chalk.dim(`* sets the topic to ${chalk.cyan(msgtxt)}`)}`
    }

    return timestamp + (emote ? ' * ' : ' ') + (highlight ? chalk.bgRed(chalk.black(authorText)) : authorText) + ' ' + content
  }
  return chalk.cyan('unknown message type: ') + chalk.inverse(JSON.stringify(msg.value))
}

function saveConfig (config, path) {
  let data = yaml.safeDump(config, {
    sortKeys: true
  })
  fs.writeFileSync(path, data, 'utf8')
}

function formatTime (t) {
  return strftime('%T', new Date(t))
}

function keyToColour (key) {
  var n = 0
  for (var i = 0; i < key.length; i++) {
    n += parseInt(key[i], 16)
    n = n % colours.length
  }
  return colours[n]
}

var colours = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  // 'gray',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright'
]

module.exports = NeatScreen
