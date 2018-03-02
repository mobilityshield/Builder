<!DOCTYPE html>
<html>
<!--

== OpenJSCAD.org, Copyright (c) 2016-2017, Licensed under MIT License ==
   in conjunction with other libraries by various authors (see the individual files)

Purpose:
  This application provides an example of how to show JSCAD designs with minimal HTML and CSS.
  
  (02/03/2018) - Modified by JRodrigo.net for the Mobility Shield Proyect
-->
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>Mobility Shield - Viewer</title>
  <link rel="stylesheet" href="min.css" type="text/css">
  <style type="text/css">
  body {
	margin-left: 0px;
	margin-top: 0px;
	margin-right: 0px;
	margin-bottom: 0px;
}

div.minimal {
    width: 0px;
	height: 0px;
    border: 0px;
    padding: 0px !important;
    margin: 0px !important;
}
  </style>
</head>

<body>
  <script src="dist/min.js"></script>
<!-- setup display of the errors as required by OpenJSCAD.js -->
<div class="jscad-container minimal">
    <div class="minimal"  id="header">
      <div class="minimal" id="errordiv"></div>
    </div>

<!-- setup display of the viewer, i.e. canvas -->
    <div oncontextmenu="return false;" id="viewerContext" design-url="examples/logo.jscad" style="margin: 0px !important;"></div>

<!-- setup display of the status, as required by OpenJSCAD.js -->
<!-- set display: block to display this -->
    <div class="minimal" id="tail" style="display: none;">
      <div class="minimal" id="statusdiv"></div>
    </div>
  </div>
</body>

</html>
