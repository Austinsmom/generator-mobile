'use strict';
var exec = require('child_process').exec;
var path = require('path');
var yeoman = require('yeoman-generator');
var yosay = require('yosay');
var chalk = require('chalk');
var prompt = require('./prompt');
var download = require('./download');
var hosting = require('./hosting');
var deps = require('./deps');

module.exports = yeoman.generators.Base.extend({
  constructor: function () {
    yeoman.generators.Base.apply(this, arguments);

    this.option('skip-welcome-message', {
      desc: 'Skip welcome message',
      type: Boolean,
      defaults: false
    });

    this.option('skip-install', {
      desc: 'Do not install dependencies',
      type: Boolean,
      defaults: false
    });

    this.option('quiet', {
      desc: 'Be quiet; only errors will be shown',
      type: Boolean,
      defaults: false
    });

    this.skipWelcome = this.options['skip-welcome-message'];
    this.skipInstall = this.options['skip-install'];
    this.quiet = this.options.quiet;
    this.verbose = !this.quiet;
    this.pkg = require('../package.json');
    this.messages = [];
    this.checks = {};
  },

  prompting: function () {
    var self = this;
    var done = this.async();

    var promptUser = function (defaults) {
      self.prompt(prompt.questions(defaults), function (answers) {
        prompt.populateMissing(answers);

        if (!answers.confirmed) {
          promptUser(answers);
          return;
        }

        delete answers.confirmed;
        self.prompts = answers;
        done();
      });
    };

    if (this.verbose && !this.skipWelcome) {
      this.log(yosay('Web Starter Kit generator'));
    }

    promptUser();
  },

  configuring: function () {
    var self = this;
    var done = this.async();

    if (this.verbose) {
      this.log.write().info('Getting latest WSK release version ...');
    }

    download({
      extract: true,
      strip: 1
    }, function (err, downloader, url, ver) {
      if (err) {
        self.log.error(err);
        process.exit(1);
      }

      if (self.verbose) {
        self.log.info('Found release %s', ver.tag_name)
          .info('Fetching %s ...', url)
          .info(chalk.yellow('This might take a few moments'));

        downloader.use(function (res) {
          res.on('data', function () {
            self.log.write('.');
          });
        });
      }

      downloader.dest(self.destinationRoot()).run(function (err) {
        if (err) {
          self.log.write().error(err).write();
          process.exit(1);
        }

        if (self.verbose) {
          self.log.write().ok('Done').info('Checking dependencies ...');
        }

        var checks = deps.checkAll(self.prompts);

        checks.on('done', done);
        checks.on('passed', function (res) {
          self.checks[res.what] = {data: res.data};

          if (self.verbose) {
            self.log.ok(res.what + ' ' + (res.result || ''));
          }
        });

        checks.on('failed', function (res) {
          self.checks[res.what] = {data: res.data, error: res.error};
          self.messages.push(res.error.message);
          self.log.error(res.error.message);
        });
      });
    });
  },

  writing: {
    gulpfile: function () {
      if (this.verbose) {
        this.log.info('Configuring gulpfile.js');
      }

      var filepath = path.join(this.destinationRoot(), 'gulpfile.js');
      var gulpfile = this.readFileAsString(filepath);
      var repl;

      // pagespeed
      if (this.prompts.siteUrl) {
        repl = '$1url: \'' + this.prompts.siteUrl + '\'';
        gulpfile = gulpfile.replace(/(pagespeed(?:.|\s)+)url:[^,]+/m, repl);
      }

      // server-config
      var cfg = hosting.config(this.prompts.hostingChoice);

      if (cfg) {
        gulpfile = gulpfile.replace(/['"].*apache-server-configs.*['"]/m, '\'app/' + cfg.filename + '\'');
      } else {
        gulpfile = gulpfile.replace(/^.*apache-server-configs.*$/m, '');
      }

      // TODO: remove this and the corresponding test on the next WSK release
      gulpfile = gulpfile.replace(
        /^gulp\.task\('clean', del\.bind\(null, \['\.tmp', 'dist'\]\)\);$/m,
        'gulp.task(\'clean\', del.bind(null, [\'.tmp\', \'dist/*\', \'!dist/.git\']));'
      );

      this.writeFileFromString(gulpfile, filepath);
    },

    packagejson: function () {
      if (this.verbose) {
        this.log.info('Configuring package.json');
      }

      var filepath = path.join(this.destinationRoot(), 'package.json');
      var pkg = JSON.parse(this.readFileAsString(filepath));

      pkg.name = (this.prompts.siteName || 'replace me')
        .replace(/[^0-9a-z_\-]/ig, '-')
        .replace(/-+/g, '-');
      pkg.version = '0.0.0';
      pkg.description = this.prompts.siteDescription;
      pkg.homepage = this.prompts.siteUrl;
      pkg.main = 'app/index.html';

      delete pkg.devDependencies['apache-server-configs'];
      this.writeFileFromString(JSON.stringify(pkg, null, 2), filepath);
    },

    webmanifest: function () {
      if (this.verbose) {
        this.log.info('Configuring manifest.webapp');
      }

      var filepath = path.join(this.destinationRoot(), 'app', 'manifest.webapp');
      var manifest = JSON.parse(this.readFileAsString(filepath));

      manifest.name = this.prompts.siteName;
      manifest.description = this.prompts.siteDescription;
      manifest.locales = manifest.locales || {};
      manifest.locales.en = manifest.locales.en || {};
      manifest.locales.en.name = this.prompts.siteName;
      manifest.locales.en.description = this.prompts.siteDescription;

      this.writeFileFromString(JSON.stringify(manifest, null, 2), filepath);
    },

    layout: function () {
      if (this.verbose) {
        this.log.info('Configuring layout and contents');
      }

      var basic = path.join(this.destinationRoot(), 'app', 'basic.html');
      var index = path.join(this.destinationRoot(), 'app', 'index.html');
      var content;
      var repl1;
      var repl2;

      // Layout
      if (this.prompts.layoutChoice === 'default') {
        content = this.read(index);
      } else if (this.prompts.layoutChoice === 'ie8') {
        content = this.read(basic);
      }

      this.dest.delete(basic);

      // Google Analytics
      if (this.prompts.gaTrackId) {
        content = content.replace(/UA-XXXXX-X/g, this.prompts.gaTrackId);
      }

      // Site name and description
      if (this.prompts.siteName) {
        repl1 = '$1' + this.prompts.siteName + '$2';
        content = content.replace(/(<title>).*(<\/title>)/, repl1);
      }

      if (this.prompts.siteDescription) {
        repl2 = '$1' + this.prompts.siteDescription + '$2';
        content = content.replace(/(<meta\s+name=["']description["']\s+content=["']).*(["'])/, repl2);
      }

      this.writeFileFromString(content, index);
    },

    gcloud: function () {
      if (this.prompts.hostingChoice !== 'gae') {
        return;
      }

      this.dest.mkdir('.gcloud');
      this.template('gcloud-properties', path.join('.gcloud', 'properties'));
      this.template('deploy_gae.js', path.join('tasks', 'deploy.js'));

      var done = this.async();

      hosting.fetchConfig('gae', function (err, cfg, content) {
        if (!err) {
          content = content.replace(/^(application:\s+).*$/m, '$1' + this.prompts.gcloudProjectId);
          this.dest.write(path.join('app', cfg.filename), content);
        } else {
          this.log.error(err);
        }

        done();
      }.bind(this));
    },

    github: function () {
      if (this.prompts.hostingChoice !== 'github') {
        return;
      }

      this.dest.mkdir('dist');
      this.template('deploy_github.js', path.join('tasks', 'deploy.js'));

      if (this.prompts.siteHost && !prompt.isGitHub(this.prompts.siteHost)) {
        this.dest.write(path.join('app', 'CNAME'), this.prompts.siteHost);
      }

      if (this.checks.git.error) {
        return;
      }

      var log = !this.quiet && this.log;
      var done = this.async();

      var cmd = [
        'git init .',
        'git checkout -b ' + this.prompts.githubBranch,
        'git commit --allow-empty -m "Initial empty commit"',
        'git remote add origin git@github.com:' + this.prompts.githubTarget
      ].join(' && ');

      exec(cmd, {cwd: path.join('dist')}, function (err, stdout) {
        if (log) {
          log.write().info(stdout);
        }

        done();
      });
    }
  },

  install: {
    npminstall: function () {
      if (this.options['skip-install']) {
        return;
      }

      if (this.verbose) {
        this.log.write()
          .info('Running ' + chalk.yellow('npm install') + ' ' +
                'to install the required dependencies. ' +
                'If this fails, try running the command yourself.')
          .info(chalk.yellow('This might take a few moments'))
          .write();
      }

      this.npmInstall();
    },

    git: function () {
      if (!this.checks.git || this.checks.git.error) {
        return;
      }

      var self = this;
      var done = this.async();
      var cmd = [
        'git init',
        'git add .',
        'git commit -m "Initial commit"'
      ].join(' && ');

      exec(cmd, function (err, stdout) {
        if (err) {
          self.log.error(err);
        }

        if (self.verbose) {
          self.log.write(stdout);
        }

        done();
      });
    }
  },

  end: function () {
    if (this.messages.length === 0) {
      if (this.verbose) {
        this.log.write().ok('You are all set now. Happy coding!');
      }

      return;
    }

    this.log.write().error('There were some errors during the process:').write();

    for (var i = 0, m; (m = this.messages[i]); i++) {
      this.log.write((i + 1) + ' ' + m);
    }
  }
});
