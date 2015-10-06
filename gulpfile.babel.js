import gulp from 'gulp';
import mocha from 'gulp-spawn-mocha';
import ts from 'gulp-typescript';
import sourcemaps from 'gulp-sourcemaps';
import babel from 'gulp-babel';
import lazypipe from 'lazypipe';
import typedoc from 'gulp-typedoc';
import del from 'del';
import tsconfig from 'tsconfig-glob';

tsconfig({
    indent: 2
});

let tsProject = ts.createProject('tsconfig.json');

gulp.task('clean', () => {
    return del([
        'build',
        'dist',
        'docs'
    ])
});


gulp.task('build', ['clean'], () => {
    return tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(ts(tsProject))
        .js
        .pipe(babel())
        .pipe(sourcemaps.write('.', {
            sourceRoot: process.cwd()
        }))
        .pipe(gulp.dest('build'))
    ;
});


gulp.task('test', ['build'], () => {
    return gulp.src('build/test/**/test_*.js', {read: false})
        .pipe(mocha({
            //istanbul: true,
            reporter: 'list',
            require: ['babel-core/polyfill', 'source-map-support/register']
        }));
});


gulp.task('dist', () => {
    return gulp.src('build/src/**/*.js', {base: 'build/src'})
        .pipe(gulp.dest('dist/es6'))
        .pipe(babel())
        .pipe(gulp.dest('dist/es5'));
});


gulp.task("typedoc", () => {
    return tsProject.src()
        .pipe(typedoc(Object.assign({}, tsProject.config.compilerOptions, {
            out: "./docs",

            name: "Keyper",
            version: true
        })));
});


gulp.task('default', ['build', 'test', 'dist', 'typedoc']);


gulp.task('watch', ['test'], () => {
    gulp.watch(['src/**/*.ts', 'test/**/*.ts'], ['test']);
});