const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const {
  BACKEND_PROTOCOL = 'https',
} = process.env;

module.exports = {
  mode: 'production',
  devtool: 'sourcemap',
  stats: {
    children: false,
    warningsFilter(warning) {
      // https://github.com/webpack-contrib/mini-css-extract-plugin/issues/250#issuecomment-421989979
      return warning.indexOf('chunk styles [mini-css-extract-plugin]') >= 0;
    },
  },
  entry: { app: path.resolve(__dirname, 'src/index.js') },
  output: {
    path: path.resolve(__dirname, 'build'),
    publicPath: '/',
    filename: '[name].[chunkhash].js',
    chunkFilename: '[chunkhash].js',
  },
  resolve: { alias: { '~': path.resolve(__dirname, 'src') } },
  optimization: {
    runtimeChunk: {
      name: 'runtime',
    },
    minimizer: [
      new TerserPlugin({
        cache: true,
        parallel: true,
        sourceMap: false,
        terserOptions: {
          compress: { warnings: false },
        },
      }),
      new OptimizeCSSAssetsPlugin({}),
    ],
    splitChunks: {
      chunks: 'async',
      minSize: 30000,
      minChunks: 1,
      maxAsyncRequests: 5,
      maxInitialRequests: 3,
      automaticNameDelimiter: '~',
      name: true,
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          priority: -10
        },
        default: {
          minChunks: 2,
          priority: -20,
          reuseExistingChunk: true
        },
        styles: {
          name: 'styles',
          test: /\.(less|css)$/,
          chunks: 'all',
          minChunks: 1,
          reuseExistingChunk: true,
          enforce: true,
        },
      },
    },
  },
  module: {
    rules: [{
      test: /\.js$/,
      use: [
        { loader: 'babel-loader' },
      ],
      exclude: /node_modules/,
    }, {
      test: /\.(gif|png|jpe?g|svg)$/,
      loader: 'url-loader?limit=8192&name=static/images/[hash].[ext]',
    }, {
      test: /\.css$/,
      use: [
        MiniCssExtractPlugin.loader,
        { loader: 'css-loader?importLoaders=1' },
        { loader: 'postcss-loader' },
      ],
    }, {
      test: /\.less$/,
      use: [
        MiniCssExtractPlugin.loader,
        { loader: 'css-loader?importLoaders=1' },
        { loader: 'postcss-loader' },
        {
          loader: 'less-loader',
          options: {
            javascriptEnabled: true,
            paths: [
              path.resolve(__dirname, 'node_modules'),
              path.resolve(__dirname, 'src'),
            ],
          },
        },
      ],
    }],
  },
  plugins: [
    new CleanWebpackPlugin(['build']),
    new webpack.DefinePlugin({
      'process.env': {
        // This can reduce react lib size and disable some dev feactures like props validation
        NODE_ENV: JSON.stringify('production'),
        ENV: JSON.stringify('production'),
        BACKEND_PROTOCOL: JSON.stringify(BACKEND_PROTOCOL),
      },
    }),
    new MiniCssExtractPlugin({
      filename: '[hash].app.min.css',
    }),
    new CopyWebpackPlugin([
      { from: 'static', to: 'static' },
    ]),
    new HtmlWebpackPlugin({
      title: 'HankLiuRTC-demo',
      filename: 'index.html',
      template: path.resolve(__dirname, 'src/template.html'),
    }),
  ],
};
